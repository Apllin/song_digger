"""
SoundCloud adapter — two-stage noscript HTML scrape.

SoundCloud renders full track data inside a <noscript> tag for SEO, so a
plain httpx GET is enough — no headless browser, no API key required.

Flow per query:
  1. GET soundcloud.com/search?q=<artist track>
     → score <noscript> hits, pick the best query-match as seed
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
from app.core.seed_match import score_candidates, MATCH_NONE

SC_BASE = "https://soundcloud.com"
SC_EMBED_BASE = "https://w.soundcloud.com/player/"
DEFAULT_LIMIT = 30
_SEED_SCAN_LIMIT = 20
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
# SoundCloud system pages that appear as the first path segment.
_SKIP_FIRST_SEGMENTS = frozenset({
    "search", "discover", "you", "upload", "settings",
    "mobile", "pages", "legal", "press", "jobs", "imprint",
})

# Titles that indicate a DJ set / radio show / podcast / live mix rather than
# an individual track. These uploads share the /<user>/<slug> URL pattern
# with real tracks, so the path-based filter can't catch them.
# Matched patterns from real SoundCloud output for queries like "Anfisa Letyago":
#   - "Sam Paganini @ FVTVR Paris (April 4th 2026)"   — @ venue + month-year
#   - "Anfisa Letyago Rinse FM - December 2025"        — show name + month-year
#   - "Awakenings Podcast S381 - Andy Martin"          — show keyword
#   - "BCCO Mix Series 811: Alan Fitzpatrick"          — mix-series keyword
#   - "Carmen Lisa @ Lofi Amsterdam ... (Live) 31.01.26"
_DJ_SET_TITLE_RE = re.compile(
    r"\b(?:"
    r"podcast|mix\s*series|festival|live\s+(?:at|from|in)|b2b|"
    r"rinse\s*fm|boiler\s*room|awakenings|hor\s+\d|"
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|"
    r"jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|"
    r"nov(?:ember)?|dec(?:ember)?)\s+\d{4}"
    r")\b"
    r"|@\s+\w+"  # "Artist @ Venue" pattern
    r"|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b",  # DD.MM.YY date suffix
    re.IGNORECASE,
)

# Seed-page duration: SoundCloud's noscript HTML embeds the seed track's
# duration as `"duration": <ms>` (the first match is the seed itself).
_DURATION_RE = re.compile(r'"duration":\s*(\d+)')
# Above this seed-track duration, the recommended page tends to surface more
# DJ sets/podcasts of the same shape — skip SoundCloud entirely rather than
# pollute results.
_DJ_SET_DURATION_MS_THRESHOLD = 20 * 60 * 1000
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


def _parse_seed_duration_ms(html: str) -> int | None:
    """Extract the seed track's duration from the recommended page HTML.
    SoundCloud's noscript-adjacent JSON inlines the seed's metadata; the first
    `"duration": N` match is the seed itself. Returns ms or None on miss."""
    m = _DURATION_RE.search(html)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


async def _pick_seed(query: str, html: str) -> str | None:
    """Return the best query-matching track URL from a search page, or None.
    Each track is scored both as (uploader, title) and, when the title embeds
    'Artist - Title', as that embedded pair; the better score wins."""
    tracks = _parse_tracks(html, _SEED_SCAN_LIMIT)
    pairs: list[tuple[str, str]] = []
    owner: list[int] = []  # pairs[i] belongs to tracks[owner[i]]
    for ti, cand in enumerate(tracks):
        pairs.append((cand.artist, cand.title))
        owner.append(ti)
        if " - " in cand.title:
            ea, _, et = cand.title.partition(" - ")
            pairs.append((ea.strip(), et.strip()))
            owner.append(ti)
    if not pairs:
        print(f"[SoundCloud] no seed matched query {query!r}")
        return None
    scores = await score_candidates(query, pairs)
    best_track, best_score = -1, MATCH_NONE
    for pi, sc in enumerate(scores):
        if sc > best_score:
            best_score, best_track = sc, owner[pi]
    if best_track < 0:
        print(f"[SoundCloud] no seed matched query {query!r}")
        return None
    return tracks[best_track].sourceUrl


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

        title = a.get_text(strip=True) or _slug_to_name(track_slug)
        # Filter DJ-set / podcast / radio-show uploads — same URL shape as
        # individual tracks but useless as recommendations. The seed-duration
        # check in _fetch_recommended catches the common case where the seed
        # itself is long, this catches the per-candidate stragglers.
        if _DJ_SET_TITLE_RE.search(title):
            continue
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

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers=_HEADERS)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def find_similar(self, query: str, limit: int = DEFAULT_LIMIT) -> list[TrackMeta]:
        seed_url = await self._search_seed(query)
        if not seed_url:
            return []
        return await self._fetch_recommended(seed_url, limit)

    async def _search_seed(self, query: str) -> str | None:
        """Search SoundCloud and return a validated seed track URL, or None."""
        artist, track = _split_query(query)
        search_query = f"{artist} {track}" if track else artist
        try:
            resp = await self._client.get(f"{SC_BASE}/search", params={"q": search_query})
            resp.raise_for_status()
        except Exception as e:
            print(f"[SoundCloud] search error: {e}")
            return None
        return await _pick_seed(query, resp.text)

    async def _fetch_recommended(self, seed_url: str, limit: int) -> list[TrackMeta]:
        rec_url = seed_url.rstrip("/") + "/recommended"
        try:
            resp = await self._client.get(rec_url)
            resp.raise_for_status()
        except Exception as e:
            print(f"[SoundCloud] recommended error: {e}")
            return []
        # If the seed track is a DJ set / podcast (>20min), the recommended
        # page clusters more of the same. Bail entirely — better to contribute
        # nothing than to pollute the result list with hour-long mixes.
        seed_duration_ms = _parse_seed_duration_ms(resp.text)
        if seed_duration_ms is not None and seed_duration_ms > _DJ_SET_DURATION_MS_THRESHOLD:
            print(
                f"[SoundCloud] seed too long ({seed_duration_ms // 60000}min), skipping"
            )
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
