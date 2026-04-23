import re
import time
import asyncio
import httpx
from app.adapters.base import AbstractAdapter
from app.core.models import TrackMeta

# A stable public embed URL used only to extract the anonymous access token.
# Spotify embed pages are publicly accessible and contain the token in a
# <script> JSON block — no credentials or cookies required.
EMBED_TOKEN_URL = "https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl"
BASE_URL = "https://api.spotify.com/v1"

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
}

MAX_RELATED = 5
TRACKS_PER_ARTIST = 3


class SpotifyAdapter(AbstractAdapter):
    """
    Spotify Web API adapter using the anonymous web-player token.
    No API credentials required — uses the same token the Spotify web player
    fetches on every page load.

    Endpoints used (not deprecated as of 2025):
      GET /search?type=artist
      GET /artists/{id}/related-artists
      GET /artists/{id}/top-tracks
    """

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(base_url=BASE_URL, timeout=10.0)
        self._token: str | None = None
        self._token_expires_ms: float = 0.0
        self._lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    # ── Auth ──────────────────────────────────────────────────────────────────

    async def _ensure_token(self) -> str:
        async with self._lock:
            now_ms = time.time() * 1000
            if self._token and now_ms < self._token_expires_ms - 60_000:
                return self._token

            # Fetch a public embed page — Spotify embeds are openly accessible
            # and embed a JSON block with an anonymous access token.
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as ac:
                resp = await ac.get(EMBED_TOKEN_URL, headers=BROWSER_HEADERS)
                resp.raise_for_status()

            m = re.search(r'"accessToken"\s*:\s*"([^"]+)"', resp.text)
            exp = re.search(r'"accessTokenExpirationTimestampMs"\s*:\s*(\d+)', resp.text)
            if not m:
                raise RuntimeError("Spotify: could not extract anonymous token from embed page")

            self._token = m.group(1)
            self._token_expires_ms = float(exp.group(1)) if exp else now_ms + 3_600_000
            return self._token

    async def _get(self, path: str, **params) -> dict:
        for attempt in range(3):
            token = await self._ensure_token()
            resp = await self._client.get(
                path,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 2 ** attempt))
                await asyncio.sleep(min(retry_after, 8))
                continue
            if resp.status_code == 401:
                # Token expired — force refresh on next call
                async with self._lock:
                    self._token = None
                continue
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()
        return resp.json()

    # ── Public API ────────────────────────────────────────────────────────────

    async def search_artist_id(self, name: str) -> str | None:
        data = await self._get("/search", q=name, type="artist", limit=1)
        items = data.get("artists", {}).get("items", [])
        return items[0]["id"] if items else None

    async def get_similar_tracks(
        self, artist_name: str, limit: int = 20
    ) -> list[TrackMeta]:
        try:
            artist_id = await self.search_artist_id(artist_name)
            if not artist_id:
                return []

            related_data = await self._get(f"/artists/{artist_id}/related-artists")
            related = related_data.get("artists", [])[:MAX_RELATED]
            if not related:
                return []

            top_track_responses = await asyncio.gather(
                *[
                    self._get(f"/artists/{r['id']}/top-tracks", market="US")
                    for r in related
                ],
                return_exceptions=True,
            )

            tracks: list[TrackMeta] = []
            for i, resp in enumerate(top_track_responses):
                if not isinstance(resp, dict):
                    continue
                for t in resp.get("tracks", [])[:TRACKS_PER_ARTIST]:
                    track_id = t.get("id")
                    if not track_id:
                        continue
                    artist_str = ", ".join(
                        a["name"] for a in t.get("artists", []) if a.get("name")
                    )
                    images = t.get("album", {}).get("images", [])
                    cover = images[0]["url"] if images else None
                    tracks.append(
                        TrackMeta(
                            title=t["name"],
                            artist=artist_str or related[i]["name"],
                            source="spotify",
                            sourceUrl=f"https://open.spotify.com/track/{track_id}",
                            embedUrl=f"https://open.spotify.com/embed/track/{track_id}?utm_source=generator",
                            coverUrl=cover,
                        )
                    )

            return tracks[:limit]
        except Exception as e:
            print(f"[Spotify] get_similar_tracks error: {e}")
            return []

    async def find_similar(self, query: str, limit: int = 20) -> list[TrackMeta]:
        artist = query.split(" - ")[0].strip() if " - " in query else query.strip()
        return await self.get_similar_tracks(artist, limit)

    async def random_techno_track(self) -> TrackMeta | None:
        return None  # not implemented for Spotify
