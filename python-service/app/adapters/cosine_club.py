import httpx
from app.adapters.base import AbstractAdapter
from app.core.models import TrackMeta
from app.config import settings


class CosineClubAdapter(AbstractAdapter):
    """
    Cosine.club API — vector-similarity search over a music catalog.

    API docs: https://cosine.club/api/v1/docs (OpenAPI spec)
    Auth: Bearer token — set COSINE_CLUB_API_KEY in .env

    The public Track schema exposes only: id, artist, track, name,
    video_id, video_uri, external_link, source, score. There are NO
    BPM/key/energy/label/genre/cover_url fields — those are derived
    elsewhere (Beatport enrichment for BPM/key, YouTube thumbnail for cover).

    There is also no /random endpoint, so random_techno_track() is a no-op.
    """

    BASE_URL = "https://cosine.club/api"

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={"Authorization": f"Bearer {settings.cosine_club_api_key}"},
            timeout=15.0,
        )

    async def find_similar(self, query: str, limit: int = 20) -> list[TrackMeta]:
        """
        Two-step: search for the query, then fetch similar by track id.
        Returns [] if the search has no hits or any step fails.
        """
        try:
            seed_id = await self._search_first_id(query)
            if not seed_id:
                return []
            resp = await self._client.get(
                f"/v1/tracks/{seed_id}/similar",
                params={"limit": limit},
            )
            resp.raise_for_status()
            payload = resp.json()
            similar = (payload.get("data") or {}).get("similar_tracks") or []
            return [self._parse(t) for t in similar]
        except httpx.HTTPError as e:
            print(f"[CosineClub] find_similar error: {e}")
            return []

    async def search_suggestions(self, query: str, limit: int = 10) -> list[str]:
        """Return 'Artist - Title' strings for autocomplete."""
        try:
            resp = await self._client.get(
                "/v1/search",
                params={"q": query, "limit": limit},
            )
            resp.raise_for_status()
            data = resp.json().get("data") or []
            results = []
            for t in data:
                artist = t.get("artist", "")
                title = t.get("track") or t.get("name") or ""
                if artist and title:
                    results.append(f"{artist} - {title}")
                elif title:
                    results.append(title)
            return results
        except httpx.HTTPError as e:
            print(f"[CosineClub] search_suggestions error: {e}")
            return []

    async def random_techno_track(self) -> TrackMeta | None:
        # The new Cosine.club public API has no /random endpoint. Random tracks
        # come from other adapters (Beatport / YTM / Yandex).
        return None

    async def _search_first_id(self, query: str) -> str | None:
        resp = await self._client.get(
            "/v1/search",
            params={"q": query, "limit": 1},
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        if not data:
            return None
        return data[0].get("id")

    def _parse(self, data: dict) -> TrackMeta:
        video_id = data.get("video_id")
        return TrackMeta(
            title=data.get("track") or data.get("name") or "Unknown",
            artist=data.get("artist") or "Unknown",
            source="cosine_club",
            sourceUrl=data.get("video_uri") or data.get("external_link") or "",
            coverUrl=f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg" if video_id else None,
            score=data.get("score"),
        )

    async def aclose(self) -> None:
        await self._client.aclose()
