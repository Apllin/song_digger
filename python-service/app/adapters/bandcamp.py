import asyncio
import html
import json
import re
from dataclasses import asdict, dataclass
from urllib.parse import urlparse, urlunparse

import httpx
from app.adapters.base import AbstractAdapter
from app.core.db import fetch_external_cache, upsert_external_cache
from app.core.models import TrackMeta

# Browser-shaped UA so the public site doesn't immediately serve the Imperva
# client-challenge page. The JSON API and track HTML pages currently respond
# fine with this; the old /search HTML page does NOT — it's challenge-gated.
_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_SEARCH_API = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic"
_SEARCH_HEADERS = {
    **_BROWSER_HEADERS,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/json",
    "Origin": "https://bandcamp.com",
    "Referer": "https://bandcamp.com/",
}

# Each "you may also like" item is a single <li> with all the data we need
# embedded as attributes — no per-item HTTP fetch required (unlike the old
# data-recommended-from-tralbum JSON blob, which sometimes omitted IDs).
_REC_LI_RE = re.compile(r'<li class="recommended-album[^"]*"[^>]*>', re.S)
_ATTR_RES = {
    "album_id": re.compile(r'data-albumid="(\d+)"'),
    "title": re.compile(r'data-albumtitle="([^"]*)"'),
    "artist": re.compile(r'data-artist="([^"]*)"'),
}

# Bandcamp album pages embed the full tralbum payload as
# <... data-tralbum="{...html-entity-encoded JSON...}"> on the player wrapper.
_TRALBUM_RE = re.compile(r'data-tralbum="([^"]+)"', re.S)

# Sentinel that identifies the Imperva client-challenge interstitial — when
# Bandcamp serves this, the request was bot-detected and there's no real
# content to parse.
_CHALLENGE_MARKERS = ("Client Challenge", "_fs-ch-")


@dataclass
class _AlbumRef:
    album_id: str
    album_title: str
    artist: str
    album_url: str
    cover_url: str | None


class BandcampAdapter(AbstractAdapter):
    """
    Finds similar tracks via Bandcamp's "you may also like" footer.

    Flow:
      1. POST the query to the public search JSON endpoint and pick the first
         track-type hit.
      2. GET that track's HTML page and parse the `<li class="recommended-album">`
         blocks in its footer; each carries title/artist/album_id/cover, but no
         track-level metadata.
      3. For each recommended album, GET the album page in parallel and pull
         the first entry of its `data-tralbum` JSON `trackinfo` array. That
         gives a real track title, track URL, and track id for the embed
         player. If an album page is anti-bot challenged, fails to fetch, or
         lacks trackinfo, that album is dropped — never falls back to album-as-
         track, so the result list represents real tracks only.

    Anti-bot signal: every challenge / fetch failure logs with a `[Bandcamp]`
    prefix. If every recommended album fails, we log
    `[Bandcamp] all album fetches failed` so a dead source is loud in
    observability rather than just returning an empty list silently.
    """

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            headers=_BROWSER_HEADERS,
            timeout=10.0,
            follow_redirects=True,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def find_similar(self, query: str, limit: int = 7) -> list[TrackMeta]:
        try:
            track_url = await self._search_track(query)
            if not track_url:
                return []
            refs = await self._get_album_refs(track_url, limit)
            if not refs:
                return []
            tracks = await asyncio.gather(
                *(self._resolve_first_track(ref) for ref in refs)
            )
            results = [t for t in tracks if t is not None]
            if not results:
                print(f"[Bandcamp] all album fetches failed for {track_url}")
            return results
        except Exception as e:
            print(f"[Bandcamp] find_similar error: {e}")
            return []

    async def _search_track(self, query: str) -> str | None:
        """Resolve the first track-type hit for `query` to a canonical track URL."""
        payload = {
            "search_text": query,
            "search_filter": "t",  # tracks only
            "full_page": False,
            "fan_id": None,
        }
        try:
            resp = await self._client.post(_SEARCH_API, json=payload, headers=_SEARCH_HEADERS)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"[Bandcamp] search api error: {e}")
            return None

        results = (data.get("auto") or {}).get("results") or []
        for item in results:
            if item.get("type") != "t":
                continue
            url = item.get("item_url_path") or item.get("tralbum_url") or item.get("url")
            if url:
                return url
        print(f"[Bandcamp] search empty: {query!r}")
        return None

    async def _get_album_refs(self, track_url: str, limit: int) -> list[_AlbumRef]:
        """Fetch the seed track page and parse its 'you may also like' footer.

        Returns up to `limit` AlbumRef entries — album-level metadata only;
        track resolution happens in `_resolve_first_track`.

        Cache: track-page recommendations are essentially immutable (a published
        Bandcamp track page's footer doesn't change after the fact), so positive
        hits never expire. Empty results are NOT cached — those are typically
        Imperva challenges or transient fetch errors; we want a retry next time.
        """
        cache_key = f"{track_url}|{limit}"
        cached = await fetch_external_cache(
            source="bandcamp_recs",
            cache_key=cache_key,
            ttl_seconds=None,  # forever
        )
        if cached is not None:
            return [_AlbumRef(**r) for r in cached]

        try:
            resp = await self._client.get(track_url)
            resp.raise_for_status()
            page = resp.text
        except Exception as e:
            print(f"[Bandcamp] track page error: {e}")
            return []

        if any(marker in page for marker in _CHALLENGE_MARKERS):
            print(f"[Bandcamp] track page challenged: {track_url}")
            return []

        refs: list[_AlbumRef] = []
        seen_album_ids: set[str] = set()

        for li_open in _REC_LI_RE.finditer(page):
            li_attrs = li_open.group(0)

            album_id_m = _ATTR_RES["album_id"].search(li_attrs)
            if not album_id_m:
                continue
            album_id = album_id_m.group(1)
            if album_id in seen_album_ids:
                continue
            seen_album_ids.add(album_id)

            title_m = _ATTR_RES["title"].search(li_attrs)
            artist_m = _ATTR_RES["artist"].search(li_attrs)
            title = html.unescape(title_m.group(1)) if title_m else "Unknown"
            artist = html.unescape(artist_m.group(1)) if artist_m else "Unknown"

            # The <a class="album-link" href="..."> and <img class="album-art" src="...">
            # live in the body of the same <li>. Slice from this <li>'s opening tag
            # to the next one (or end of section) and search within that window.
            li_start = li_open.end()
            next_li = _REC_LI_RE.search(page, pos=li_start)
            li_end = next_li.start() if next_li else min(li_start + 4000, len(page))
            li_body = page[li_start:li_end]

            href_m = re.search(r'<a class="album-link"[^>]*href="([^"]+)"', li_body)
            album_url = href_m.group(1) if href_m else f"https://bandcamp.com/album/{album_id}"
            # Strip the tracking ?from=... param so dedup across runs is stable.
            album_url = album_url.split("?", 1)[0]

            cover_m = re.search(r'<img class="album-art"[^>]*src="([^"]+)"', li_body)
            cover_url = cover_m.group(1) if cover_m else None

            refs.append(_AlbumRef(
                album_id=album_id,
                album_title=title,
                artist=artist,
                album_url=album_url,
                cover_url=cover_url,
            ))
            if len(refs) >= limit:
                break

        if not refs:
            print(f"[Bandcamp] no recs in page: {track_url}")
            return refs

        await upsert_external_cache(
            source="bandcamp_recs",
            cache_key=cache_key,
            payload=[asdict(r) for r in refs],
        )
        return refs

    async def _resolve_first_track(self, ref: _AlbumRef) -> TrackMeta | None:
        """Fetch the album page and return its first track as a TrackMeta.

        Returns None if the page is challenged, the fetch fails, or the
        embedded `data-tralbum` JSON is missing/empty/unparseable. We don't
        fall back to album-level metadata — a None result is the signal that
        this rec couldn't be resolved to a real track.
        """
        try:
            resp = await self._client.get(ref.album_url)
            resp.raise_for_status()
            page = resp.text
        except Exception as e:
            print(f"[Bandcamp] album page error ({ref.album_url}): {e}")
            return None

        if any(marker in page for marker in _CHALLENGE_MARKERS):
            print(f"[Bandcamp] album page challenged: {ref.album_url}")
            return None

        m = _TRALBUM_RE.search(page)
        if not m:
            print(f"[Bandcamp] no data-tralbum on {ref.album_url}")
            return None

        try:
            tralbum = json.loads(html.unescape(m.group(1)))
        except json.JSONDecodeError as e:
            print(f"[Bandcamp] data-tralbum parse error ({ref.album_url}): {e}")
            return None

        trackinfo = tralbum.get("trackinfo") or []
        if not trackinfo:
            print(f"[Bandcamp] empty trackinfo on {ref.album_url}")
            return None

        first = trackinfo[0]
        track_id = first.get("track_id") or first.get("id")
        if not track_id:
            print(f"[Bandcamp] no track id in first trackinfo entry on {ref.album_url}")
            return None

        track_title = first.get("title") or ref.album_title
        title_link = first.get("title_link") or ""
        track_url = _resolve_url(ref.album_url, title_link) if title_link else ref.album_url

        embed_url = (
            f"https://bandcamp.com/EmbeddedPlayer/track={track_id}"
            f"/size=small/bgcol=1a1a1a/linkcol=4ec5ec/transparent=true/"
        )

        return TrackMeta(
            title=track_title,
            artist=ref.artist,
            source="bandcamp",
            sourceUrl=track_url,
            embedUrl=embed_url,
            coverUrl=ref.cover_url,
        )


def _resolve_url(base: str, path: str) -> str:
    """Resolve a `title_link` (e.g. '/track/foo') against the host of `base`."""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    parsed = urlparse(base)
    return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))
