import re
import json
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

_RETRY_DELAY_SECONDS = 2.0


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

    return TrackMeta(
        title=title,
        artist=artist,
        source="beatport",
        sourceUrl=f"https://www.beatport.com/track/{track_name.lower().replace(' ', '-')}/{track_id}",
        coverUrl=cover_url,
        bpm=t.get("bpm"),
        key=_to_camelot(t.get("key_name")),
    )


class BeatportAdapter(AbstractAdapter):
    """
    Scrapes Beatport search results from __NEXT_DATA__ JSON embedded in HTML.
    Enrichment-only — not part of the /similar fan-out.
    """

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            headers=HEADERS, timeout=10.0, follow_redirects=True
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def enrich_tracks(
        self,
        tracks: list[TrackMeta],
        max_concurrent: int = 5,
    ) -> dict[str, TrackMeta]:
        """
        For each track without BPM/key, search Beatport and fill in the data.
        Returns a dict sourceUrl → enriched TrackMeta. Already-complete tracks
        are returned untouched (no Beatport call).
        """
        semaphore = asyncio.Semaphore(max_concurrent)

        async def enrich_one(track: TrackMeta) -> tuple[str, TrackMeta]:
            if track.bpm is not None and track.key is not None:
                return track.sourceUrl, track
            async with semaphore:
                result = await self._fetch_bpm_key(track.title, track.artist)
                if result:
                    bpm, key = result
                    return track.sourceUrl, track.model_copy(update={
                        "bpm": track.bpm if track.bpm is not None else bpm,
                        "key": track.key if track.key is not None else key,
                    })
                return track.sourceUrl, track

        pairs = await asyncio.gather(*[enrich_one(t) for t in tracks])
        return dict(pairs)

    async def _fetch_bpm_key(
        self, title: str, artist: str
    ) -> tuple[float, str] | None:
        """Search Beatport for the track and return (bpm, camelot_key) only when
        the title signature matches exactly (via shared `_seed_match` logic that
        cosine_club uses for its seed resolution). Avoids the loose prefix-substring
        match the original implementation used."""
        results = await self.find_similar(f"{artist} {title}", limit=5)
        match_query = f"{artist} - {title}"
        for t in results:
            if t.bpm is None or t.key is None:
                continue
            if query_match_score(match_query, t.artist, t.title) >= MATCH_EXACT:
                return t.bpm, t.key
        return None

    async def find_similar(self, query: str, limit: int = 20) -> list[TrackMeta]:
        url = f"https://www.beatport.com/search/tracks?q={query.replace(' ', '+')}"
        for attempt in (1, 2):
            try:
                resp = await self._client.get(url)
                resp.raise_for_status()
                return self._parse_html(resp.text, limit)
            except (httpx.HTTPStatusError, httpx.RequestError) as e:
                status = getattr(getattr(e, "response", None), "status_code", None)
                if attempt == 1 and (status is None or status >= 500 or status == 429):
                    await asyncio.sleep(_RETRY_DELAY_SECONDS)
                    continue
                print(f"[Beatport] find_similar error: {e}")
                return []
        return []

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
