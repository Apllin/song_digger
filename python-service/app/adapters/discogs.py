import asyncio
import httpx
from app.config import settings

BASE_URL = "https://api.discogs.com"


class DiscogsAdapter:
    """
    Fetches artist discography (releases + tracklists) via Discogs REST API.
    Docs: https://www.discogs.com/developers/
    Rate limit: 60 req/min (authenticated).

    Uses a persistent httpx client so multiple paginated requests share one
    TCP connection instead of reopening it for every call.
    Retries automatically on 429 Rate-Limit (up to 3 attempts, honours Retry-After).

    Soft-degrades when DISCOGS_TOKEN is missing: every public method returns
    an empty result instead of firing a guaranteed-401 request.
    """

    def __init__(self) -> None:
        headers = {"User-Agent": "SongDigger/1.0"}
        if settings.discogs_token:
            headers["Authorization"] = f"Discogs token={settings.discogs_token}"
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            headers=headers,
            timeout=20.0,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, **kwargs) -> httpx.Response:
        """GET with automatic retry on 429 and transient 5xx (up to 3 attempts)."""
        for attempt in range(3):
            resp = await self._client.get(path, **kwargs)
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 2 ** attempt))
                await asyncio.sleep(min(retry_after, 10))
                continue
            if resp.status_code >= 500 and attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            return resp
        resp.raise_for_status()
        return resp  # unreachable; satisfies type checker

    async def search_artist(self, query: str, limit: int = 10) -> list[dict]:
        """Search for artists by name."""
        if not settings.discogs_token:
            return []
        resp = await self._get(
            "/database/search",
            params={"q": query, "type": "artist", "per_page": limit},
        )
        results = resp.json().get("results", [])
        return [
            {
                "id": r.get("id"),
                "name": r.get("title"),
                "imageUrl": r.get("thumb"),
                "resourceUrl": r.get("resource_url"),
            }
            for r in results
            if r.get("id")
        ]

    async def get_releases(
        self, artist_id: int, page: int = 1, per_page: int = 20
    ) -> dict:
        """
        Get paginated list of artist releases.
        Returns: { releases, pagination: { page, pages, total } }
        """
        if not settings.discogs_token:
            return {"releases": [], "pagination": {}}
        resp = await self._get(
            f"/artists/{artist_id}/releases",
            params={
                "sort": "year",
                "sort_order": "desc",
                "page": page,
                "per_page": per_page,
            },
        )
        data = resp.json()
        releases = [
            {
                "id": r.get("id"),
                "title": r.get("title"),
                "year": r.get("year"),
                "type": r.get("type"),   # "master" | "release"
                "role": r.get("role"),   # "Main" | "Appearance" | "TrackAppearance"
                "format": r.get("format"),
                "label": r.get("label"),
                "thumb": r.get("thumb"),
                "resourceUrl": r.get("resource_url"),
            }
            for r in data.get("releases", [])
        ]
        return {
            "releases": releases,
            "pagination": data.get("pagination", {}),
        }

    async def search_label(self, query: str, limit: int = 10) -> list[dict]:
        """Search for labels by name."""
        if not settings.discogs_token:
            return []
        resp = await self._get(
            "/database/search",
            params={"q": query, "type": "label", "per_page": limit},
        )
        results = resp.json().get("results", [])
        return [
            {
                "id": r.get("id"),
                "name": r.get("title"),
                "imageUrl": r.get("thumb"),
                "resourceUrl": r.get("resource_url"),
            }
            for r in results
            if r.get("id")
        ]

    async def get_label_releases(
        self, label_id: int, page: int = 1, per_page: int = 100
    ) -> dict:
        """
        Get paginated releases for a label.
        Returns: { releases, pagination: { page, pages, total } }
        """
        if not settings.discogs_token:
            return {"releases": [], "pagination": {}}
        resp = await self._get(
            f"/labels/{label_id}/releases",
            params={
                "sort": "year",
                "sort_order": "desc",
                "page": page,
                "per_page": per_page,
            },
        )
        data = resp.json()
        releases = [
            {
                "id": r.get("id"),
                "title": r.get("title"),
                "year": r.get("year"),
                "artist": r.get("artist"),
                "format": r.get("format"),
                "catno": r.get("catno"),
                "thumb": r.get("thumb"),
                "type": r.get("type"),
                "resourceUrl": r.get("resource_url"),
            }
            for r in data.get("releases", [])
            if r.get("id")
        ]
        return {
            "releases": releases,
            "pagination": data.get("pagination", {}),
        }

    async def get_tracklist(self, release_id: int, release_type: str = "release") -> list[dict]:
        """
        Get full tracklist for a release or master release.
        release_type: "master" or "release"
        """
        if not settings.discogs_token:
            return []
        endpoint = (
            f"/masters/{release_id}"
            if release_type == "master"
            else f"/releases/{release_id}"
        )
        resp = await self._get(endpoint)
        data = resp.json()
        return [
            {
                "position": t.get("position", ""),
                "title": t.get("title", "Unknown"),
                "duration": t.get("duration", ""),
                "artists": [a.get("name", "") for a in t.get("artists", [])],
            }
            for t in data.get("tracklist", [])
            if t.get("type_") != "heading"
        ]
