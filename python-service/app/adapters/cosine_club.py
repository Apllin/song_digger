import httpx
from app.adapters.base import AbstractAdapter
from app.adapters._seed_match import SEED_CANDIDATES, query_match_score
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
        """Resolve the query to a seed track id, validating relevance.

        Cosine.club's `/v1/search` is fuzzy and returns *something* for almost
        any input. Without validation we end up using an off-genre track as the
        seed and the recommendations are nonsense. Scan up to `SEED_CANDIDATES`
        hits and apply the two regimes from `_seed_match.query_match_score`:
        "Artist - Title" queries require an exact title-signature match;
        bare-artist queries pick the first candidate whose artist matches. If
        no candidate qualifies, return None and the caller emits no results.
        """
        resp = await self._client.get(
            "/v1/search",
            params={"q": query, "limit": SEED_CANDIDATES},
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        if not data:
            return None
        best_idx = -1
        best_score = 0
        for i, cand in enumerate(data):
            cand_artist = cand.get("artist") or ""
            cand_title = cand.get("track") or cand.get("name") or ""
            score = query_match_score(query, cand_artist, cand_title)
            if score > best_score:
                best_score = score
                best_idx = i
        if best_idx >= 0:
            cand = data[best_idx]
            cand_artist = cand.get("artist") or ""
            cand_title = cand.get("track") or cand.get("name") or ""
            print(
                f"[CosineClub] seed for {query!r} -> "
                f"{cand_artist} - {cand_title} (id={cand.get('id')}, score={best_score})"
            )
            return cand.get("id")
        rejected = ", ".join(
            f"{c.get('artist')!r} - {c.get('track') or c.get('name')!r}"
            for c in data[:SEED_CANDIDATES]
        )
        print(f"[CosineClub] no seed matched query {query!r}; rejected: {rejected}")
        return None

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
