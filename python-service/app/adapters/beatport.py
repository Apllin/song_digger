import re
import json
import asyncio
import httpx
from app.adapters.base import AbstractAdapter
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

    genre_list = t.get("genre") or []
    genre = genre_list[0].get("genre_name") if genre_list else None

    label_data = t.get("label") or {}
    label = label_data.get("label_name")

    return TrackMeta(
        title=title,
        artist=artist,
        source="beatport",
        sourceUrl=f"https://www.beatport.com/track/{track_name.lower().replace(' ', '-')}/{track_id}",
        coverUrl=cover_url,
        bpm=t.get("bpm"),
        key=_to_camelot(t.get("key_name")),
        genre=genre,
        label=label,
    )


class BeatportAdapter(AbstractAdapter):
    """
    Scrapes Beatport search results from __NEXT_DATA__ JSON embedded in HTML.
    Returns BPM and Camelot key — the primary source of audio metadata.
    No API key required.
    """

    def __init__(self) -> None:
        # Shared client reuses the connection pool across concurrent requests
        # instead of paying TCP/TLS handshake overhead on every scrape.
        self._client = httpx.AsyncClient(
            headers=HEADERS, timeout=5.0, follow_redirects=True
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
        Returns a dict sourceUrl → enriched TrackMeta.
        """
        semaphore = asyncio.Semaphore(max_concurrent)

        async def enrich_one(track: TrackMeta) -> tuple[str, TrackMeta]:
            async with semaphore:
                result = await self._fetch_bpm_key(track.title, track.artist)
                if result:
                    bpm, key = result
                    return track.sourceUrl, track.model_copy(update={"bpm": bpm, "key": key})
                return track.sourceUrl, track

        pairs = await asyncio.gather(*[enrich_one(t) for t in tracks])
        return dict(pairs)

    async def _fetch_bpm_key(
        self, title: str, artist: str
    ) -> tuple[float, str] | None:
        """Search Beatport for title+artist, return (bpm, camelot_key) if found."""
        query = f"{artist} {title}"
        results = await self.find_similar(query, limit=5)
        title_lower = title.lower()
        artist_lower = artist.lower()
        for t in results:
            if t.bpm is None or t.key is None:
                continue
            # Require at least artist or title to fuzzy-match
            if (
                artist_lower[:6] in t.artist.lower()
                or title_lower[:8] in t.title.lower()
            ):
                return t.bpm, t.key
        return None

    async def _fetch_next_data_html(self, url: str) -> str:
        """
        Stream the response and stop reading as soon as the __NEXT_DATA__ script
        tag has closed. Saves ~80% of bandwidth on heavy Beatport pages.
        """
        buffer = ""
        start_marker = '__NEXT_DATA__'
        end_marker = '</script>'
        found_start = False

        async with self._client.stream("GET", url) as response:
            response.raise_for_status()
            async for chunk in response.aiter_text(chunk_size=8192):
                buffer += chunk
                if not found_start and start_marker in buffer:
                    found_start = True
                if found_start:
                    # Find the closing </script> after the marker
                    marker_pos = buffer.index(start_marker)
                    if end_marker in buffer[marker_pos:]:
                        break
        return buffer

    async def find_similar(self, query: str, limit: int = 20) -> list[TrackMeta]:
        url = f"https://www.beatport.com/search/tracks?q={query.replace(' ', '+')}"
        try:
            html = await self._fetch_next_data_html(url)
            return self._parse_html(html, limit)
        except httpx.HTTPError as e:
            print(f"[Beatport] find_similar error: {e}")
            return []

    async def random_techno_track(self) -> TrackMeta | None:
        import random
        tags = ["techno", "dark-techno", "dub-techno", "industrial-techno", "minimal-techno"]
        tag = random.choice(tags)
        url = f"https://www.beatport.com/genre/{tag}/tracks"
        try:
            html = await self._fetch_next_data_html(url)
            tracks = self._parse_html(html, limit=50)
            return random.choice(tracks) if tracks else None
        except httpx.HTTPError as e:
            print(f"[Beatport] random_techno_track error: {e}")
            return None

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
