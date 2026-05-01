import re
import html
import httpx
from app.adapters.base import AbstractAdapter
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

# Sentinel that identifies the Imperva client-challenge interstitial — when
# Bandcamp serves this, the request was bot-detected and there's no real
# content to parse.
_CHALLENGE_MARKERS = ("Client Challenge", "_fs-ch-")


class BandcampAdapter(AbstractAdapter):
    """
    Finds similar albums via Bandcamp's "you may also like" footer section.

    Flow:
      1. POST the query to Bandcamp's public search JSON endpoint and pick
         the first track-type hit.
      2. GET that track's HTML page and parse the `<li class="recommended-album">`
         blocks in the page footer; each carries title/artist/album_id as
         attributes, so a single page load yields all results.
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
            return await self._get_recommendations(track_url, limit)
        except Exception as e:
            print(f"[Bandcamp] find_similar error: {e}")
            return []

    async def random_techno_track(self) -> TrackMeta | None:
        return None

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

    async def _get_recommendations(self, track_url: str, limit: int) -> list[TrackMeta]:
        """Fetch the track page and parse its 'you may also like' footer."""
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

        results: list[TrackMeta] = []
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
            source_url = href_m.group(1) if href_m else f"https://bandcamp.com/album/{album_id}"
            # Strip the tracking ?from=... param so dedup across runs is stable.
            source_url = source_url.split("?", 1)[0]

            cover_m = re.search(r'<img class="album-art"[^>]*src="([^"]+)"', li_body)
            cover_url = cover_m.group(1) if cover_m else None

            results.append(_build_album_meta(source_url, title, artist, cover_url, album_id))
            if len(results) >= limit:
                break

        if not results:
            print(f"[Bandcamp] no recs in page: {track_url}")

        return results


def _build_album_meta(
    item_url: str,
    title: str,
    artist: str,
    cover_url: str | None,
    album_id: str,
) -> TrackMeta:
    embed_url = (
        f"https://bandcamp.com/EmbeddedPlayer/album={album_id}"
        f"/size=small/bgcol=1a1a1a/linkcol=4ec5ec/transparent=true/"
    )
    return TrackMeta(
        title=title,
        artist=artist,
        source="bandcamp",
        sourceUrl=item_url,
        embedUrl=embed_url,
        coverUrl=cover_url,
    )
