import asyncio
import re
import httpx
from fastapi import APIRouter
from app.adapters.youtube_music import YouTubeMusicAdapter

router = APIRouter()
_ytm = YouTubeMusicAdapter()

MUSICBRAINZ_ARTIST_URL = "https://musicbrainz.org/ws/js/artist"
MUSICBRAINZ_RECORDING_URL = "https://musicbrainz.org/ws/2/recording"
MB_HEADERS = {"User-Agent": "TrackDigger/1.0 (localhost)"}


async def _mb_artist_search(query: str) -> list[str]:
    """MusicBrainz artist autocomplete — good for artist-only inputs."""
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                MUSICBRAINZ_ARTIST_URL,
                params={"q": query, "limit": 10},
                headers=MB_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
            return [
                f"{item['name']} ({item['disambiguation']})"
                if item.get("disambiguation")
                else item["name"]
                for item in data
                if item.get("name")
            ][:10]
    except Exception as e:
        print(f"[Suggestions] MB artist error: {e}")
        return []


async def _mb_recording_search(artist: str, title_prefix: str) -> list[str]:
    """
    MusicBrainz structured recording search.
    Query: artist:"Oscar Mulero" AND recording:the b
    This ranks exact artist matches at the top, then finds tracks whose
    title starts with / contains the prefix.
    """
    query = f'artist:"{artist}" AND recording:{title_prefix}'
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                MUSICBRAINZ_RECORDING_URL,
                params={"query": query, "limit": 10, "fmt": "json"},
                headers=MB_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
            results: list[str] = []
            for rec in data.get("recordings", []):
                title = rec.get("title", "")
                credits = rec.get("artist-credit") or []
                if not title or not credits:
                    continue
                rec_artist = credits[0].get("artist", {}).get("name", "")
                if rec_artist and title:
                    results.append(f"{rec_artist} - {title}")
            return results[:10]
    except Exception as e:
        print(f"[Suggestions] MB recording error: {e}")
        return []


async def _ytm_song_search(query: str) -> list[str]:
    """YTM song search — returns actual matching songs, not vague suggestions."""
    try:
        results = await _ytm.search_songs(query, limit=10)
        out: list[str] = []
        for r in results:
            title = r.get("title", "")
            artists = r.get("artists") or []
            artist = ", ".join(a.get("name", "") for a in artists if a.get("name"))
            if title and artist:
                out.append(f"{artist} - {title}")
        return out[:10]
    except Exception as e:
        print(f"[Suggestions] YTM song search error: {e}")
        return []


async def _ytm_artist_tracks(artist: str, limit: int = 5) -> list[str]:
    """
    For artist-only queries: returns 'Artist - Track' strings from YTM top songs.
    Lets the user see and pick specific tracks without typing ' - ' manually.
    """
    try:
        results = await _ytm.search_songs(artist, limit=limit)
        out: list[str] = []
        for r in results:
            title = r.get("title", "")
            artists = r.get("artists") or []
            a = ", ".join(x.get("name", "") for x in artists if x.get("name"))
            if title and a:
                out.append(f"{a} - {title}")
        return out[:limit]
    except Exception as e:
        print(f"[Suggestions] YTM artist tracks error: {e}")
        return []


def _dedupe_ordered(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for s in items:
        key = s.lower()
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out


# After a track title, only these markers signal a legitimate suffix
# (remix, version, featured artist). Anything else means a different track.
_TITLE_SUFFIX_RE = re.compile(
    r"^\s+([(\[\-/&,]|feat\b|ft\b|featuring\b|vs\b|with\b)",
    re.IGNORECASE,
)


def _normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _filter_track_matches(
    suggestions: list[str], artist_query: str, title_query: str
) -> list[str]:
    """
    Keep "Artist - Title" suggestions whose artist contains the searched artist
    and whose title is the searched title — optionally followed by a remix /
    version / feature suffix (paren, bracket, dash, feat, ...).
    """
    artist_n = _normalize_text(artist_query)
    title_n = _normalize_text(title_query)
    out: list[str] = []
    for s in suggestions:
        if " - " not in s:
            continue
        s_artist, _, s_title = s.partition(" - ")
        if artist_n not in _normalize_text(s_artist):
            continue
        s_title_n = _normalize_text(s_title)
        if not s_title_n.startswith(title_n):
            continue
        rest = s_title_n[len(title_n):]
        if not rest or _TITLE_SUFFIX_RE.match(rest):
            out.append(s)
    return out


def _rerank_by_coverage(items: list[str], query: str) -> list[str]:
    """
    For multi-word queries re-rank suggestions by how many query words appear
    in each suggestion. Suggestions that contain more of the query words rank
    higher. Equal-coverage items keep their original relative order (stable sort).

    Example: query "Headphones Sascha Funke"
      "Sascha Funke, Nina Kraviz - Headphones"  → 3/3 words  → rank 1
      "Sascha Funke"                             → 2/3 words  → rank 2
      "Cornelia Funke"                           → 1/3 words  → rank 6
    """
    words = [w.lower() for w in query.split() if len(w) > 1]
    if len(words) < 2:
        return items  # single-word query — ordering is already correct

    def coverage(s: str) -> int:
        s_lower = s.lower()
        return sum(1 for w in words if w in s_lower)

    return sorted(items, key=coverage, reverse=True)


@router.get("/suggestions")
async def get_suggestions(q: str) -> list[str]:
    if not q or len(q) < 2:
        return []

    # ── Artist + Track pattern: "Oscar Mulero - the b" ──────────────────────
    if " - " in q:
        parts = q.split(" - ", 1)
        artist_part = parts[0].strip()
        title_part = parts[1].strip()

        if artist_part and title_part:
            # MusicBrainz structured Lucene query (best for exact completions)
            # + YTM song search as parallel fallback.
            # Cosine.club intentionally skipped — audio similarity, not text.
            mb_results, ytm_results = await asyncio.gather(
                _mb_recording_search(artist_part, title_part),
                _ytm_song_search(q),
                return_exceptions=True,
            )

            combined: list[str] = []
            if isinstance(mb_results, list):
                combined.extend(mb_results)
            if isinstance(ytm_results, list):
                combined.extend(ytm_results)

            if not combined:
                fallback = await _ytm.get_suggestions(q)
                return _filter_track_matches(fallback, artist_part, title_part)[:10]

            deduped = _dedupe_ordered(combined)
            # Strict filter: only the exact track + its remix/version/feature
            # variants. Drops unrelated MB/YTM noise the user explicitly asked
            # us to stop showing.
            return _filter_track_matches(deduped, artist_part, title_part)[:10]

        # Edge case: "Artist - " with empty title → treat as artist-only
        q = artist_part

    # ── Artist-only ──────────────────────────────────────────────────────────
    # Run three sources in parallel:
    #   1. MB artist autocomplete → artist name strings (e.g. "Oscar Mulero")
    #   2. YTM top songs for this artist → "Artist - Track" strings
    #      (lets the user pick a specific track without typing ' - ')
    #   3. YTM raw search suggestions → fallback catch-all
    mb_artists, artist_tracks, ytm_suggestions = await asyncio.gather(
        _mb_artist_search(q),
        _ytm_artist_tracks(q, limit=5),
        _ytm.get_suggestions(q),
        return_exceptions=True,
    )

    mb_artists = mb_artists if isinstance(mb_artists, list) else []
    artist_tracks = artist_tracks if isinstance(artist_tracks, list) else []
    ytm_suggestions = ytm_suggestions if isinstance(ytm_suggestions, list) else []

    # Merge: artist names first, then "Artist - Track" completions, then raw suggestions.
    combined = mb_artists + artist_tracks + ytm_suggestions
    # Dedupe with a wider window so re-ranking has more candidates to work with.
    deduped = _dedupe_ordered(combined)[:20]
    # For multi-word queries re-rank by how many query words each suggestion
    # contains — this floats track suggestions like "Sascha Funke - Headphones"
    # above unrelated artist-name matches like "Cornelia Funke".
    reranked = _rerank_by_coverage(deduped, q)
    return reranked[:10]
