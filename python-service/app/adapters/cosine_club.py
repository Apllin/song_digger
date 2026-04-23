import httpx
from app.adapters.base import AbstractAdapter
from app.core.models import TrackMeta
from app.config import settings


class CosineClubAdapter(AbstractAdapter):
    """
    Cosine.club API — returns tracks similar by audio embedding.
    Provides BPM, key, energy for most techno tracks in its 1.15M catalog.

    API docs: https://registry.scalar.com/@cosine/apis/cosineclub-api/
    Auth: JWT (EdDSA) — set COSINE_CLUB_API_KEY in .env
    """

    BASE_URL = "https://api.cosine.club"

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={"Authorization": f"Bearer {settings.cosine_club_api_key}"},
            timeout=15.0,
        )

    async def find_similar(self, query: str, limit: int = 20) -> list[TrackMeta]:
        try:
            resp = await self._client.get(
                "/v1/similar",
                params={"q": query, "limit": limit},
            )
            resp.raise_for_status()
            data = resp.json()
            return [self._parse(t) for t in data.get("tracks", [])]
        except httpx.HTTPError as e:
            print(f"[CosineClub] find_similar error: {e}")
            return []

    async def search_suggestions(self, query: str, limit: int = 10) -> list[str]:
        """Return 'Artist - Title' strings for autocomplete."""
        try:
            resp = await self._client.get(
                "/v1/similar",
                params={"q": query, "limit": limit},
            )
            resp.raise_for_status()
            data = resp.json()
            results = []
            for t in data.get("tracks", []):
                artist = t.get("artist", "")
                title = t.get("title", "")
                if artist and title:
                    results.append(f"{artist} - {title}")
                elif title:
                    results.append(title)
            return results
        except httpx.HTTPError as e:
            print(f"[CosineClub] search_suggestions error: {e}")
            return []

    async def random_techno_track(self) -> TrackMeta | None:
        try:
            resp = await self._client.get(
                "/v1/random",
                params={"genre": "techno"},
            )
            resp.raise_for_status()
            data = resp.json()
            # Normalise: API may return a list, a wrapped dict, or a flat dict
            if isinstance(data, list):
                data = data[0] if data else None
            elif isinstance(data, dict):
                if "tracks" in data:
                    tracks = data["tracks"]
                    data = tracks[0] if tracks else None
                elif "track" in data:
                    data = data["track"]
            if not data or not isinstance(data, dict):
                return None
            return self._parse(data)
        except Exception as e:
            print(f"[CosineClub] random_techno_track error: {e}")
            return None

    def _parse(self, data: dict) -> TrackMeta:
        return TrackMeta(
            title=data.get("title", "Unknown"),
            artist=data.get("artist", "Unknown"),
            source="cosine_club",
            sourceUrl=data.get("url", ""),
            coverUrl=data.get("cover_url"),
            bpm=data.get("bpm"),
            key=data.get("key"),        # expect Camelot notation from API
            energy=data.get("energy"),
            genre=data.get("genre"),
            label=data.get("label"),
            score=data.get("score"),
        )

    async def aclose(self) -> None:
        await self._client.aclose()
