"""
SoundCloud adapter — two-stage noscript HTML scrape.

SoundCloud renders full track data inside a <noscript> tag for SEO, so a
plain httpx GET is enough — no headless browser, no API key required.

Flow per query:
  1. GET soundcloud.com/search?q=<artist track>
     → parse <noscript> for the first matching track URL
  2. GET soundcloud.com/<artist>/<track>/recommended
     → parse <noscript> for recommended track links / metadata

Soft-degrades on any HTTP or parse error.
"""
import re
import urllib.parse

import httpx
from bs4 import BeautifulSoup

from app.adapters.base import AbstractAdapter
from app.core.models import TrackMeta
from app.core.title_norm import strip_recording_suffixes

SC_BASE = "https://soundcloud.com"
SC_EMBED_BASE = "https://w.soundcloud.com/player/"
DEFAULT_LIMIT = 30
TIMEOUT_SECONDS = 4.0

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# /artist/track — exactly 2 non-empty path segments.
_TRACK_PATH_RE = re.compile(r"^/[^/]+/[^/]+$")
# SoundCloud track title prefixes added by labels/channels. Three forms:
#   "PREMIERE: Ignez - …"   (colon separator)
#   "PREMIERE | BENZA - …"  (pipe separator)
#   "[FREE DL] MAURER - …"  (bracketed prefix)
_PROMO_WORDS = r"(?:premiere|exclusive|free\s+(?:download|dl)|out\s+now|official)"
_TITLE_PREFIX_RE = re.compile(
    rf"^(?:\[{_PROMO_WORDS}\]\s*|{_PROMO_WORDS}\s*[:|]\s*)",
    re.IGNORECASE,
)
# Catalog-number suffixes (e.g. "[SOMOV010]", "[DT120]") at the end of a title
_CATALOG_SUFFIX_RE = re.compile(r"\s*\[[A-Z]{2,}[A-Z0-9]*\d+\]\s*$", re.IGNORECASE)
# Label-name suffixes (e.g. "[Divinity Records]", "[Tresor Music]") at the end of a title
_LABEL_SUFFIX_RE = re.compile(
    r"\s*\[[^\]]*\b(?:records?|recordings?|music|label)\]\s*$",
    re.IGNORECASE,
)
# Promotional suffixes in brackets or parens (e.g. "[Free DL]", "(Free Download)")
_PROMO_SUFFIX_RE = re.compile(
    r"\s*[([](?:free\s+(?:dl|download)|out\s+now|premiere|exclusive)[)\]]\s*$",
    re.IGNORECASE,
)
# SoundCloud system pages that appear as the first path segment.
_SKIP_FIRST_SEGMENTS = frozenset({
    "search", "discover", "you", "upload", "settings",
    "mobile", "pages", "legal", "press", "jobs", "imprint",
})
# Profile sub-pages that appear as the second path segment.
_SKIP_SECOND_SEGMENTS = frozenset({
    "sets", "likes", "following", "followers",
    "reposts", "tracks", "albums", "popular-tracks",
    "sounds", "people",  # /search/* nav links
})


def _is_track_path(path: str) -> bool:
    if not _TRACK_PATH_RE.match(path):
        return False
    parts = path.strip("/").split("/")
    return (
        len(parts) == 2
        and parts[0] not in _SKIP_FIRST_SEGMENTS
        and parts[1] not in _SKIP_SECOND_SEGMENTS
    )


def _embed_url(source_url: str) -> str:
    return f"{SC_EMBED_BASE}?url={urllib.parse.quote(source_url, safe='')}&auto_play=false"


def _slug_to_name(slug: str) -> str:
    return slug.replace("-", " ").title()


def _clean_title(raw: str) -> str:
    title = _TITLE_PREFIX_RE.sub("", raw).strip()
    # Promo suffix before catalog: "[MY01] (FREE DOWNLOAD)" needs promo stripped
    # first to expose the catalog number at the end.
    title = _PROMO_SUFFIX_RE.sub("", title).strip()
    title = _CATALOG_SUFFIX_RE.sub("", title).strip()
    title = _LABEL_SUFFIX_RE.sub("", title).strip()
    title = strip_recording_suffixes(title).strip()
    return title


def _resolve_path(href: str) -> str | None:
    """Return a /path string from an href, or None if it's not a soundcloud.com link."""
    if not href.startswith("http"):
        return href if href.startswith("/") else None
    parsed = urllib.parse.urlparse(href)
    if parsed.netloc in ("soundcloud.com", "www.soundcloud.com"):
        return parsed.path
    return None


def _noscript_soup(html: str) -> BeautifulSoup | None:
    """Return a parsed soup of the content-bearing noscript tag.

    SoundCloud emits two noscript tags: the first is a short JS-disabled error
    page, the second (larger one) contains the actual SEO track data. We pick
    the one with the most content to skip the error page.
    """
    outer = BeautifulSoup(html, "html.parser")
    tags = outer.find_all("noscript")
    if not tags:
        return None
    best = max(tags, key=lambda t: len(t.decode_contents()))
    content = best.decode_contents().strip()
    if not content:
        return None
    return BeautifulSoup(content, "html.parser")


def _first_track_url(html: str) -> str | None:
    inner = _noscript_soup(html)
    if not inner:
        return None
    for a in inner.find_all("a", href=True):
        path = _resolve_path(a["href"])
        if path and _is_track_path(path):
            return f"{SC_BASE}{path}"
    return None


def _parse_tracks(html: str, limit: int) -> list[TrackMeta]:
    inner = _noscript_soup(html)
    if not inner:
        return []

    results: list[TrackMeta] = []
    seen: set[str] = set()

    for a in inner.find_all("a", href=True):
        if len(results) >= limit:
            break

        path = _resolve_path(a["href"])
        if not path or not _is_track_path(path):
            continue

        source_url = f"{SC_BASE}{path}"
        if source_url in seen:
            continue
        seen.add(source_url)

        artist_slug, track_slug = path.strip("/").split("/", 1)

        title = _clean_title(a.get_text(strip=True)) or _slug_to_name(track_slug)
        artist_name = _slug_to_name(artist_slug)

        # Look for a sibling <a> whose href matches the artist slug exactly.
        parent = a.parent
        if parent:
            for sibling in parent.find_all("a", href=True):
                sibling_path = _resolve_path(sibling["href"])
                if sibling_path and sibling_path.strip("/") == artist_slug:
                    text = sibling.get_text(strip=True)
                    if text:
                        artist_name = text
                    break

        cover_url: str | None = None
        if parent:
            img = parent.find("img", src=True)
            if img:
                cover_url = img.get("src") or None

        results.append(TrackMeta(
            title=title,
            artist=artist_name,
            source=SoundCloudAdapter.name,
            sourceUrl=source_url,
            embedUrl=_embed_url(source_url),
            coverUrl=cover_url,
        ))

    return results


class SoundCloudAdapter(AbstractAdapter):
    name = "soundcloud"

    async def find_similar(self, query: str, limit: int = DEFAULT_LIMIT) -> list[TrackMeta]:
        artist, track = _split_query(query)
        # Artist-only: search by name — _first_track_url skips the artist profile
        # page (single-segment path) and picks the first track result as seed.
        search_query = f"{artist} {track}" if track else artist

        seed_url = await self._search_seed(search_query)
        if not seed_url:
            return []

        return await self._fetch_recommended(seed_url, limit)

    async def _search_seed(self, query: str) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers=_HEADERS) as client:
                resp = await client.get(f"{SC_BASE}/search", params={"q": query})
                resp.raise_for_status()
        except Exception as e:
            print(f"[SoundCloud] search error: {e}")
            return None
        return _first_track_url(resp.text)

    async def _fetch_recommended(self, seed_url: str, limit: int) -> list[TrackMeta]:
        rec_url = seed_url.rstrip("/") + "/recommended"
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers=_HEADERS) as client:
                resp = await client.get(rec_url, headers=_HEADERS)
                resp.raise_for_status()
        except Exception as e:
            print(f"[SoundCloud] recommended error: {e}")
            return []
        # The page links back to the seed (player widget at the top), so without
        # this exclusion the queried track itself leaks into the results.
        # Parse limit+1 so dropping the seed still yields `limit` tracks.
        tracks = _parse_tracks(resp.text, limit + 1)
        seed_normalized = seed_url.rstrip("/")
        return [t for t in tracks if t.sourceUrl.rstrip("/") != seed_normalized][:limit]

    async def random_techno_track(self) -> TrackMeta | None:
        return None


def _split_query(query: str) -> tuple[str, str | None]:
    """Parse "Artist - Track" -> (artist, track). Returns (query, None) when no separator."""
    if " - " not in query:
        return query.strip(), None
    artist, _, track = query.partition(" - ")
    artist = artist.strip()
    track = track.strip()
    return artist, track or None
