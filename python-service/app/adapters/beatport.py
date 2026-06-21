import re
import os
import json
import random
import asyncio
import httpx
from app.adapters.base import AbstractAdapter
from app.adapters._seed_match import query_match_score, MATCH_EXACT
from app.core.models import TrackMeta

# Maps Beatport key_name → Camelot notation
# Beatport format: "<note> Major" or "<note> Minor"
CAMELOT_MAP: dict[str, str] = {
    "A Major": "11B",  "A Minor": "8A",
    "Bb Major": "6B",  "Bb Minor": "3A",
    "B Major": "1B",   "B Minor": "10A",
    "C Major": "8B",   "C Minor": "5A",
    "Db Major": "3B",  "Db Minor": "12A",
    "D Major": "10B",  "D Minor": "7A",
    "Eb Major": "5B",  "Eb Minor": "2A",
    "E Major": "12B",  "E Minor": "9A",
    "F Major": "7B",   "F Minor": "4A",
    "Gb Major": "2B",  "Gb Minor": "11A",
    "G Major": "9B",   "G Minor": "6A",
    "Ab Major": "4B",  "Ab Minor": "1A",
    # Enharmonic aliases
    "A# Major": "6B",  "A# Minor": "3A",
    "C# Major": "3B",  "C# Minor": "12A",
    "D# Major": "5B",  "D# Minor": "2A",
    "F# Major": "2B",  "F# Minor": "11A",
    "G# Major": "4B",  "G# Minor": "1A",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.S,
)

# Tunable via env so concurrency/timeout can be adjusted without a redeploy.
TIMEOUT_SECONDS = float(os.getenv("BEATPORT_TIMEOUT_SECONDS", "8.0"))
CONNECT_TIMEOUT_SECONDS = float(os.getenv("BEATPORT_CONNECT_TIMEOUT_SECONDS", "5.0"))
MAX_RETRIES = int(os.getenv("BEATPORT_MAX_RETRIES", "3"))
_RETRY_BASE_SECONDS = 1.0


class BeatportFetchError(Exception):
    """A Beatport request failed after retries (HTTP/network/timeout) — distinct
    from a successful response that simply had no matching track. Callers use
    this to avoid marking a track permanently as 'no audio features' on a
    transient failure (which would otherwise never be retried)."""


def _retry_delay(attempt: int, exc: Exception) -> float:
    """Exponential backoff with full jitter; honours Retry-After when present.
    Jitter de-synchronises concurrent retries so a burst of 429s doesn't
    stampede Beatport in lockstep."""
    resp = getattr(exc, "response", None)
    if resp is not None:
        retry_after = resp.headers.get("Retry-After")
        if retry_after and retry_after.isdigit():
            return float(retry_after)
    base = _RETRY_BASE_SECONDS * (2 ** (attempt - 1))
    return base + random.uniform(0.0, base)


def _to_camelot(key_name: str | None) -> str | None:
    if not key_name:
        return None
    return CAMELOT_MAP.get(key_name.strip())


def _parse_track(t: dict) -> TrackMeta | None:
    track_id = t.get("track_id")
    track_name = t.get("track_name")
    if not track_id or not track_name:
        return None

    mix_name = t.get("mix_name", "")
    title = f"{track_name} ({mix_name})" if mix_name and mix_name != "Original Mix" else track_name

    artists = t.get("artists") or []
    artist = ", ".join(a.get("artist_name", "") for a in artists) or "Unknown"

    release = t.get("release") or {}
    cover_url = release.get("release_image_uri") or t.get("track_image_uri")

    genres = t.get("genre") or []
    genre = genres[0].get("genre_name") if genres else None

    return TrackMeta(
        title=title,
        artist=artist,
        source="beatport",
        sourceUrl=f"https://www.beatport.com/track/{track_name.lower().replace(' ', '-')}/{track_id}",
        coverUrl=cover_url,
        bpm=t.get("bpm"),
        key=_to_camelot(t.get("key_name")),
        genre=genre,
    )


class BeatportAdapter(AbstractAdapter):
    """
    Scrapes Beatport search results from __NEXT_DATA__ JSON embedded in HTML.
    Enrichment-only — not part of the /similar fan-out.
    """

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            headers=HEADERS,
            timeout=httpx.Timeout(TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
            follow_redirects=True,
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def enrich_tracks(
        self,
        tracks: list[TrackMeta],
        max_concurrent: int = 5,
    ) -> tuple[dict[str, TrackMeta], set[str]]:
        """
        For each track without BPM/key, search Beatport and fill in the data.
        Returns (sourceUrl → enriched TrackMeta, set of sourceUrls whose scrape
        failed transiently). Already-complete tracks are returned untouched (no
        Beatport call). A track in the failed set was NOT resolved — the caller
        must not mark it as permanently enriched, so it is retried next time.
        """
        semaphore = asyncio.Semaphore(max_concurrent)
        failed: set[str] = set()

        async def enrich_one(track: TrackMeta) -> tuple[str, TrackMeta]:
            if track.bpm is not None and track.key is not None:
                return track.sourceUrl, track
            async with semaphore:
                try:
                    result = await self._fetch_bpm_key(track.title, track.artist)
                except BeatportFetchError:
                    failed.add(track.sourceUrl)
                    return track.sourceUrl, track
            if result:
                bpm, key, genre = result
                return track.sourceUrl, track.model_copy(update={
                    "bpm": track.bpm if track.bpm is not None else bpm,
                    "key": track.key if track.key is not None else key,
                    "genre": track.genre if track.genre is not None else genre,
                })
            return track.sourceUrl, track

        pairs = await asyncio.gather(*[enrich_one(t) for t in tracks])
        enriched = dict(pairs)
        with_features = sum(1 for t in enriched.values() if t.bpm is not None or t.key is not None)
        print(
            f"[Beatport] enrich: {len(tracks)} in / {with_features} with features / "
            f"{len(failed)} failed (concurrency={max_concurrent})"
        )
        return enriched, failed

    async def _fetch_bpm_key(
        self, title: str, artist: str
    ) -> tuple[float, str, str | None] | None:
        """Search Beatport for the track and return (bpm, camelot_key, genre) only
        when the title signature matches exactly (via shared `_seed_match` logic
        that cosine_club uses for its seed resolution). Genre rides along from the
        same matched track (it's free in the search payload) so callers can fill
        the seed's training genre. Raises BeatportFetchError on a transient fetch
        failure so the caller can tell 'not found' apart from 'lookup failed'."""
        results = await self._search(f"{artist} {title}", limit=5)
        match_query = f"{artist} - {title}"
        for t in results:
            if t.bpm is None or t.key is None:
                continue
            if query_match_score(match_query, t.artist, t.title) >= MATCH_EXACT:
                return t.bpm, t.key, t.genre
        return None

    async def find_similar(self, query: str, limit: int = 20) -> list[TrackMeta]:
        """AbstractAdapter entry point — soft-degrades a fetch failure to an empty
        list. Enrichment uses `_search` directly to distinguish failure instead."""
        try:
            return await self._search(query, limit)
        except BeatportFetchError as e:
            print(f"[Beatport] find_similar error: {e}")
            return []

    async def _search(self, query: str, limit: int) -> list[TrackMeta]:
        """One Beatport search with bounded retries on transient errors. Returns
        parsed tracks (possibly empty when nothing matched); raises
        BeatportFetchError when the request itself fails after retries."""
        url = f"https://www.beatport.com/search/tracks?q={query.replace(' ', '+')}"
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = await self._client.get(url)
                resp.raise_for_status()
                return self._parse_html(resp.text, limit)
            except (httpx.HTTPStatusError, httpx.RequestError) as e:
                status = getattr(getattr(e, "response", None), "status_code", None)
                retriable = status is None or status >= 500 or status == 429
                if attempt < MAX_RETRIES and retriable:
                    await asyncio.sleep(_retry_delay(attempt, e))
                    continue
                raise BeatportFetchError(f"{query!r}: {e}") from e
        raise BeatportFetchError(f"{query!r}: retries exhausted")

    def _parse_html(self, html: str, limit: int) -> list[TrackMeta]:
        match = NEXT_DATA_RE.search(html)
        if not match:
            print("[Beatport] __NEXT_DATA__ not found")
            return []

        try:
            data = json.loads(match.group(1))
            queries = data["props"]["pageProps"]["dehydratedState"]["queries"]
            raw_tracks = queries[0]["state"]["data"]["data"]
        except (KeyError, IndexError, json.JSONDecodeError) as e:
            print(f"[Beatport] parse error: {e}")
            return []

        results = []
        for t in raw_tracks[:limit]:
            parsed = _parse_track(t)
            if parsed:
                results.append(parsed)

        return results
