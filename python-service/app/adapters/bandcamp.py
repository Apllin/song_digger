import re
import json
import asyncio
import httpx
from app.adapters.base import AbstractAdapter
from app.core.models import TrackMeta

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Bandcamp pages embed track/album data in a <script data-tralbum="..."> attribute
TRALBUM_RE = re.compile(r'data-tralbum="([^"]+)"')

# "you may also like" recommendations live in a JSON blob on the page:
# <div id="recommended-items" data-recommended-from-tralbum="...">
RECS_RE = re.compile(r'data-recommended-from-tralbum="([^"]+)"')


def _unescape(s: str) -> str:
    """Unescape HTML entities that Bandcamp puts in data attributes."""
    return (
        s.replace("&quot;", '"')
         .replace("&amp;", "&")
         .replace("&#39;", "'")
         .replace("&lt;", "<")
         .replace("&gt;", ">")
    )


class BandcampAdapter(AbstractAdapter):
    """
    Finds similar tracks via Bandcamp's "you may also like" section.

    Flow:
      1. Search Bandcamp for the query → get the first matching track URL
      2. Fetch that track page → parse the "recommended" data attribute
      3. For each recommendation, fetch its page to get the numeric ID for embedding
      4. Build Bandcamp EmbeddedPlayer URLs from those IDs

    Uses a persistent httpx client so the 7 concurrent _resolve_item calls
    reuse connections instead of each creating a new TCP socket.
    """

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            headers=HEADERS,
            timeout=10.0,
            follow_redirects=True,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def find_similar(self, query: str, limit: int = 7) -> list[TrackMeta]:
        try:
            track_url = await self._search_track(query)
            if not track_url:
                return []
            return await self._get_recommendations(track_url, limit)
        except Exception as e:
            print(f"[Bandcamp] find_similar error: {e}")
            return []

    async def random_techno_track(self) -> TrackMeta | None:
        return None

    async def _search_track(self, query: str) -> str | None:
        """Search Bandcamp for a track and return the URL of the first result."""
        url = f"https://bandcamp.com/search?q={query.replace(' ', '+')}&item_type=t"
        try:
            resp = await self._client.get(url)
            resp.raise_for_status()
            match = re.search(
                r'class="searchresult track".*?<a\s+href="(https://[^"]+/track/[^"?#]+)',
                resp.text,
                re.S,
            )
            return match.group(1) if match else None
        except Exception as e:
            print(f"[Bandcamp] search error: {e}")
            return None

    async def _get_recommendations(self, track_url: str, limit: int) -> list[TrackMeta]:
        """Fetch a track page and extract the 'you may also like' recommendations."""
        try:
            resp = await self._client.get(track_url)
            resp.raise_for_status()
            html = resp.text
        except Exception as e:
            print(f"[Bandcamp] fetch track page error: {e}")
            return []

        recs_match = RECS_RE.search(html)
        if not recs_match:
            return []

        try:
            recs_data = json.loads(_unescape(recs_match.group(1)))
        except json.JSONDecodeError as e:
            print(f"[Bandcamp] recs JSON parse error: {e}")
            return []

        items = recs_data.get("results", [])[:limit]
        if not items:
            return []

        results = await asyncio.gather(
            *[self._resolve_item(item) for item in items],
            return_exceptions=True,
        )

        return [r for r in results if isinstance(r, TrackMeta)]

    async def _resolve_item(self, item: dict) -> TrackMeta | None:
        """
        Given a recommendation item dict from Bandcamp, fetch its page and
        build a TrackMeta with an EmbeddedPlayer URL.
        """
        item_url = item.get("url", "")
        if not item_url:
            return None

        if item_url.startswith("//"):
            item_url = "https:" + item_url

        title = item.get("title", "Unknown")
        artist = item.get("artist", "Unknown")
        cover_url: str | None = next(
            (item[k] for k in ("art_url", "thumbnail_url", "image_url") if item.get(k)),
            None,
        )

        is_track = "/track/" in item_url

        try:
            resp = await self._client.get(item_url)
            resp.raise_for_status()
            page_html = resp.text
        except Exception as e:
            print(f"[Bandcamp] resolve item error for {item_url}: {e}")
            return None

        tralbum_match = TRALBUM_RE.search(page_html)
        if not tralbum_match:
            return None

        try:
            tralbum = json.loads(_unescape(tralbum_match.group(1)))
        except json.JSONDecodeError:
            return None

        item_id = tralbum.get("id")
        if not item_id:
            return None

        if artist == "Unknown":
            artist = tralbum.get("artist", "Unknown")

        if not cover_url:
            art = tralbum.get("art_id")
            if art:
                cover_url = f"https://f4.bcbits.com/img/a{art}_10.jpg"

        if is_track:
            embed_url = (
                f"https://bandcamp.com/EmbeddedPlayer/track={item_id}"
                f"/size=small/bgcol=1a1a1a/linkcol=4ec5ec/transparent=true/"
            )
        else:
            embed_url = (
                f"https://bandcamp.com/EmbeddedPlayer/album={item_id}"
                f"/size=small/bgcol=1a1a1a/linkcol=4ec5ec/transparent=true/"
            )

        return TrackMeta(
            title=title,
            artist=artist,
            source="bandcamp",
            sourceUrl=item_url,
            embedUrl=embed_url,
            coverUrl=cover_url,
        )
