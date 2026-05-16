"""
Bandcamp label-discography adapter — staleness fallback for Discogs.

See ADR-0024 for the rationale and the legal/operational posture.
Soft-degrades to empty results on Imperva interstitials, HTTP errors,
or missing JSON blobs; the orchestrator treats degradation as silent.
"""
import html as html_lib
import json
import re
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from app.core.db import fetch_external_cache, upsert_external_cache

BCSEARCH_URL = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

_TIMEOUT = 10.0
_TTL_30D = 30 * 86400
_TTL_6MO = 180 * 86400

_TRALBUM_RE = re.compile(r'data-tralbum\s*=\s*"([^"]+)"')
_CLIENT_ITEMS_RE = re.compile(r'data-client-items\s*=\s*"([^"]+)"')
_GRID_ITEM_RE = re.compile(
    r'<li[^>]*data-item-id="(album|track)-(\d+)"[^>]*>(.+?)</li>',
    re.DOTALL,
)
_GRID_HREF_RE = re.compile(r'href="([^"]+)"')
_GRID_TITLE_RE = re.compile(r'<p[^>]*class="title"[^>]*>\s*([^<\n]+)')
_GRID_ARTIST_RE = re.compile(
    r'<span[^>]*class="artist-override"[^>]*>\s*([^<]+?)\s*</span>'
)
_GRID_ART_RE = re.compile(r'src="https://f4\.bcbits\.com/img/a(\d+)_')

_IMPERVA_MARKERS = ("incapsula", "_incapsula_resource", "imperva")


def _is_imperva(html: str) -> bool:
    head = html[:2048].lower()
    return any(m in head for m in _IMPERVA_MARKERS)


def _parse_html_json_attr(html: str, regex: re.Pattern) -> Any:
    m = regex.search(html)
    if not m:
        return None
    try:
        return json.loads(html_lib.unescape(m.group(1)))
    except (ValueError, json.JSONDecodeError):
        return None


def _bandcamp_cover_url(art_id: int | None) -> str | None:
    if not art_id:
        return None
    return f"https://f4.bcbits.com/img/a{art_id}_2.jpg"


def _format_duration(seconds: float | None) -> str:
    if seconds is None or seconds <= 0:
        return ""
    total = int(round(seconds))
    return f"{total // 60}:{total % 60:02d}"


def _parse_release_year(rfc2822: str | None) -> int | None:
    if not rfc2822:
        return None
    try:
        dt = parsedate_to_datetime(rfc2822)
    except (TypeError, ValueError):
        return None
    return dt.year if dt else None


def _rfc2822_to_iso_date(rfc2822: str | None) -> str:
    if not rfc2822:
        return ""
    try:
        dt = parsedate_to_datetime(rfc2822)
    except (TypeError, ValueError):
        return ""
    return dt.strftime("%Y-%m-%d") if dt else ""


class BandcampAdapter:
    """Bandcamp label discography adapter — staleness fallback for Discogs."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=_TIMEOUT,
            follow_redirects=True,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def search_label(self, name: str, limit: int = 10) -> list[dict]:
        """Bandcamp label search by name. Returns raw relevance order; caller enforces exact-name match."""
        norm = " ".join(name.lower().split())
        if not norm:
            return []
        # v2: fixed URL field (item_url_root for labels, not item_url_path).
        cache_key = f"v2|{norm}|{limit}"
        cached = await fetch_external_cache(
            source="bandcamp_search_label",
            cache_key=cache_key,
            ttl_seconds=_TTL_30D,
        )
        if cached is not None:
            return cached

        try:
            resp = await self._client.post(
                BCSEARCH_URL,
                json={
                    "search_text": name,
                    "search_filter": "b",
                    "full_page": True,
                    "fan_id": None,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"[bandcamp] search_label error name={name!r}: {e}")
            return []

        results = ((data.get("auto") or {}).get("results") or [])
        out: list[dict] = []
        for r in results:
            if r.get("type") != "b":
                continue
            band_name = r.get("name") or ""
            # Labels use item_url_root (their subdomain); tracks/albums use item_url_path.
            url = r.get("item_url_root") or r.get("url") or ""
            if not (band_name and url):
                continue
            out.append({
                "id": r.get("id"),
                "name": band_name,
                "url": url,
                "image": r.get("img"),
            })
            if len(out) >= limit:
                break

        await upsert_external_cache(
            source="bandcamp_search_label",
            cache_key=cache_key,
            payload=out,
        )
        return out

    async def get_label_discography(self, label_url: str) -> list[dict]:
        """Every release on a label's Bandcamp /music page.

        The page splits the catalog: ~16 newest/featured items live in
        server-rendered `<li class="music-grid-item">` HTML, the rest
        (~30+) in a `data-client-items` JSON attribute. Zero overlap
        between the two — both must be parsed and unioned by id.
        """
        base = label_url.rstrip("/")
        # v2: now unions music-grid HTML with data-client-items JSON.
        cache_key = f"v2|{base}"
        cached = await fetch_external_cache(
            source="bandcamp_label_music",
            cache_key=cache_key,
            ttl_seconds=_TTL_30D,
        )
        if cached is not None:
            return cached

        url = f"{base}/music"
        try:
            resp = await self._client.get(url)
            resp.raise_for_status()
            html = resp.text
        except Exception as e:
            print(f"[bandcamp] get_label_discography error url={url}: {e}")
            return []

        if _is_imperva(html):
            print(f"[bandcamp] imperva interstitial on /music url={url}")
            return []

        items_by_id: dict[int, dict] = {}

        # Top-of-page server-rendered grid (newest/featured).
        for m in _GRID_ITEM_RE.finditer(html):
            item_type, id_str, body = m.group(1), m.group(2), m.group(3)
            try:
                item_id = int(id_str)
            except ValueError:
                continue
            href_m = _GRID_HREF_RE.search(body)
            if not href_m:
                continue
            title_m = _GRID_TITLE_RE.search(body)
            artist_m = _GRID_ARTIST_RE.search(body)
            art_m = _GRID_ART_RE.search(body)
            page_url = href_m.group(1)
            items_by_id[item_id] = {
                "id": item_id,
                "title": html_lib.unescape(title_m.group(1).strip()) if title_m else "",
                "artist": html_lib.unescape(artist_m.group(1).strip()) if artist_m else "",
                "page_url": page_url,
                "art_id": int(art_m.group(1)) if art_m else None,
                "type": item_type,
                "absolute_url": f"{base}{page_url}",
            }

        # Below-fold lazy-load catalog. Grid entries take precedence (their
        # artist-override field is more reliable than the JSON's `artist`).
        blob = _parse_html_json_attr(html, _CLIENT_ITEMS_RE)
        if isinstance(blob, list):
            for it in blob:
                item_id = it.get("id")
                page_url = it.get("page_url")
                if not (item_id and page_url) or item_id in items_by_id:
                    continue
                items_by_id[item_id] = {
                    "id": item_id,
                    "title": it.get("title") or "",
                    "artist": it.get("artist") or "",
                    "page_url": page_url,
                    "art_id": it.get("art_id"),
                    "type": it.get("type"),
                    "absolute_url": f"{base}{page_url}",
                }

        if not items_by_id:
            print(f"[bandcamp] no items parsed from /music url={url}")
            return []

        out = list(items_by_id.values())
        await upsert_external_cache(
            source="bandcamp_label_music",
            cache_key=cache_key,
            payload=out,
        )
        return out

    async def get_release_meta(self, release_url: str) -> dict | None:
        """Parse data-tralbum from /album or /track to get release date + tracklist."""
        cache_key = f"v1|{release_url}"
        cached = await fetch_external_cache(
            source="bandcamp_release_meta",
            cache_key=cache_key,
            ttl_seconds=_TTL_6MO,
        )
        if cached is not None:
            return cached

        try:
            resp = await self._client.get(release_url)
            resp.raise_for_status()
            html = resp.text
        except Exception as e:
            print(f"[bandcamp] get_release_meta error url={release_url}: {e}")
            return None

        if _is_imperva(html):
            print(f"[bandcamp] imperva interstitial on /album url={release_url}")
            return None

        blob = _parse_html_json_attr(html, _TRALBUM_RE)
        if not isinstance(blob, dict):
            print(f"[bandcamp] no data-tralbum on url={release_url}")
            return None

        current = blob.get("current") or {}
        album_artist = (blob.get("artist") or "").strip()
        # release_date = actual release day; publish_date = page-creation day (can predate).
        rfc_date = current.get("release_date") or current.get("publish_date")

        tracklist: list[dict] = []
        for t in blob.get("trackinfo") or []:
            title = (t.get("title") or "").strip()
            if not title:
                continue
            track_artist = (t.get("artist") or "").strip() or album_artist
            tracklist.append({
                "position": str(t.get("track_num") or len(tracklist) + 1),
                "title": title,
                "duration": _format_duration(t.get("duration")),
                "artists": [track_artist] if track_artist else [],
            })

        out = {
            "title": (current.get("title") or "").strip(),
            "artist": album_artist,
            "release_date": _rfc2822_to_iso_date(rfc_date),
            "year": _parse_release_year(rfc_date),
            "art_id": blob.get("art_id"),
            "tracklist": tracklist,
        }

        await upsert_external_cache(
            source="bandcamp_release_meta",
            cache_key=cache_key,
            payload=out,
        )
        return out
