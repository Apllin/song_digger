import httpx
from app.adapters.base import AbstractAdapter
from app.core.seed_match import SEED_CANDIDATES, pick_best_candidate
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
    elsewhere (YouTube thumbnail for cover).
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
        Returns [] if the search has no relevant hit or any step fails.
        """
        if not settings.cosine_club_api_key:
            return []
        try:
            seed_id = await self._search_seed_id(query)
            if not seed_id:
                return []
            return await self._fetch_similar(seed_id, limit)
        except httpx.HTTPError as e:
            print(f"[CosineClub] find_similar error: {e}")
            return []

    async def find_similar_by_url(self, url: str, limit: int = 20) -> list[TrackMeta]:
        """Seed Cosine from a track URL (YTM/YouTube/Bandcamp/SoundCloud) — TRA-25.

        Cosine parses the pasted URL and resolves the exact track even when it's
        absent from the catalog, so the small-DB miss that text `find_similar`
        hits is bypassed. No fuzzy seed-match validation: the URL pins the
        track, so the top search hit is taken directly.
        """
        if not settings.cosine_club_api_key or not url:
            return []
        try:
            resp = await self._client.get(
                "/v1/search",
                params={"q": url, "limit": 1},
            )
            resp.raise_for_status()
            data = resp.json().get("data") or []
            seed_id = data[0].get("id") if data else None
            if not seed_id:
                return []
            return await self._fetch_similar(seed_id, limit)
        except httpx.HTTPError as e:
            print(f"[CosineClub] find_similar_by_url error: {e}")
            return []

    async def _fetch_similar(self, seed_id: str, limit: int) -> list[TrackMeta]:
        """Fetch the similar-track list for a resolved seed id."""
        resp = await self._client.get(
            f"/v1/tracks/{seed_id}/similar",
            params={"limit": limit},
        )
        resp.raise_for_status()
        payload = resp.json()
        similar = (payload.get("data") or {}).get("similar_tracks") or []
        return [self._parse(t) for t in similar]

    async def search_suggestions(self, query: str, limit: int = 10) -> list[str]:
        """Return 'Artist - Title' strings for autocomplete."""
        if not settings.cosine_club_api_key:
            return []
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

    async def _search_seed_id(self, query: str) -> str | None:
        """Resolve the query to a seed track id, rejecting off-genre fuzzy hits."""
        resp = await self._client.get(
            "/v1/search",
            params={"q": query, "limit": SEED_CANDIDATES},
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        if not data:
            return None
        candidates = [
            (c.get("artist") or "", c.get("track") or c.get("name") or "")
            for c in data
        ]
        idx = await pick_best_candidate(query, candidates)
        if idx is None:
            print(f"[CosineClub] no seed matched query {query!r}")
            return None
        cand = data[idx]
        cand_artist, cand_title = candidates[idx]
        print(f"[CosineClub] seed for {query!r} -> {cand_artist} - {cand_title} (id={cand.get('id')})")
        return cand.get("id")

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
