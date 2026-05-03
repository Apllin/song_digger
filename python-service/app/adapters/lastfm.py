"""
Last.fm adapter — track.getSimilar via the public REST API.

Last.fm exposes collaborative-filtering similarity (users who scrobbled
A also scrobbled B). Coverage is strong for established artists, weak
for underground (sub-100 listener tracks often return empty or noise).
The match score is used only as a noise floor; ranking is via list
position, like all other RRF inputs.

No `random_techno_track` — Last.fm has no concept of "give me a random
track in genre X" that doesn't degrade to scraping their tag pages.
"""
import httpx
from app.adapters.base import AbstractAdapter
from app.core.models import TrackMeta
from app.config import settings

LASTFM_API_BASE = "https://ws.audioscrobbler.com/2.0/"
# Below this match value, Last.fm's similar tracks become genuinely random.
MIN_MATCH = 0.05
DEFAULT_LIMIT = 50
TIMEOUT_SECONDS = 8.0


class LastfmAdapter(AbstractAdapter):
    SOURCE = "lastfm"

    async def find_similar(self, query: str, limit: int = DEFAULT_LIMIT) -> list[TrackMeta]:
        # The project-wide adapter contract is `find_similar(query, limit)` where
        # query is "Artist - Track" or just "Artist". Last.fm's track.getSimilar
        # requires BOTH artist and track; without a track we'd need an extra
        # track.search call. Skip artist-only for now — return empty.
        artist, track = _split_query(query)
        if not track:
            return []

        api_key = settings.lastfm_api_key
        if not api_key:
            return []

        params = {
            "method": "track.getsimilar",
            "artist": artist,
            "track": track,
            "api_key": api_key,
            "format": "json",
            "limit": limit,
            "autocorrect": 1,  # let Last.fm fix "Mulero" -> "Oscar Mulero"
        }

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                resp = await client.get(LASTFM_API_BASE, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            print(f"[Lastfm] find_similar error: {e}")
            return []

        tracks_data = data.get("similartracks", {}).get("track", []) or []
        results: list[TrackMeta] = []
        for t in tracks_data:
            try:
                match = float(t.get("match", 0))
            except (TypeError, ValueError):
                match = 0.0
            if match < MIN_MATCH:
                continue

            title = (t.get("name") or "").strip()
            artist_obj = t.get("artist") or {}
            artist_name = (artist_obj.get("name") or "").strip()
            url = (t.get("url") or "").strip()
            if not title or not artist_name or not url:
                continue

            cover_url: str | None = None
            for img in t.get("image") or []:
                if img.get("size") == "extralarge":
                    cover_url = img.get("#text") or None
                    break

            results.append(
                TrackMeta(
                    title=title,
                    artist=artist_name,
                    source=self.SOURCE,
                    sourceUrl=url,
                    coverUrl=cover_url,
                    score=match,
                )
            )

        return results

    async def random_techno_track(self) -> TrackMeta | None:
        return None


def _split_query(query: str) -> tuple[str, str | None]:
    """Parse "Artist - Track" -> (artist, track). Returns (query, None) when no separator."""
    if " - " not in query:
        return query.strip(), None
    artist, _, track = query.partition(" - ")
    artist = artist.strip()
    track = track.strip()
    if not track:
        return artist, None
    return artist, track
