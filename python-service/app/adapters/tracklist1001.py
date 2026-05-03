"""
1001tracklists adapter — DJ co-occurrence within ±2 positions.

For a seed (artist, track) parsed out of the "Artist - Track" query, this
adapter looks up DJ sets where the seed appears, collects tracks within ±2
of the seed in each set, and ranks them by how many sets they appear in.

Caching: TracklistCooccurrence (web Prisma model). 7-day TTL. On cache miss,
synchronously scrape with an overall 8-second budget, populate the cache,
then return what we have. Subsequent searches for the same seed are cache
hits and return instantly.

Rate limiting: 1 request/second to 1001TL. Single AsyncClient per scrape
session to share connection pool.

Resilience: every parsing step is in its own try/except. Failures log with
URL/selector context and return empty for that step, not the whole adapter.

The /similar route should still wrap calls in asyncio.wait_for so a worst-
case cold cache + slow 1001TL doesn't block the whole fan-out.
"""
import asyncio
import time
from collections import defaultdict

import httpx
from bs4 import BeautifulSoup

from app.adapters.base import AbstractAdapter
from app.config import settings
from app.core.db import fetch_cooccurrence, upsert_cooccurrence_batch
from app.core.models import TrackMeta

BASE = "https://www.1001tracklists.com"
SEARCH = f"{BASE}/search/index.php"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
# httpx per-request timeout. Skill convention for HTML scraping = 4s; the
# overall scrape budget below caps total time across many requests.
HTTP_TIMEOUT_S = 4.0
RATE_LIMIT_S = 1.0
SCRAPE_BUDGET_S = 8.0
MAX_SETS_PER_SEED = 20
WINDOW = 2
TTL_DAYS = 7
DEFAULT_LIMIT = 50


class Tracklists1001Adapter(AbstractAdapter):
    name = "tracklist1001"

    async def find_similar(
        self, query: str, limit: int = DEFAULT_LIMIT
    ) -> list[TrackMeta]:
        # Feature-flag gate: search parser is broken against live markup
        # (1001TL search returns the homepage; likely AJAX/CSRF). Adapter
        # ships disabled until that's fixed. See app/config.py for context.
        if not settings.tracklist1001_enabled:
            return []

        # The seed→set→adjacency pivot needs both artist and track. Without a
        # specific track, return [] (parallels Last.fm's artist-only behavior).
        artist, track = _split_query(query)
        if not track:
            return []

        # Stage 1: cache hit returns immediately.
        cached = await fetch_cooccurrence(
            artist=artist, track=track, ttl_days=TTL_DAYS, limit=limit
        )
        if cached:
            return cached

        # Stage 2: cache miss — scrape with budget.
        try:
            scraped = await self._scrape_with_budget(
                artist, track, budget_s=SCRAPE_BUDGET_S
            )
        except Exception as e:
            print(f"[Tracklist1001] scrape error: {e}")
            return []

        if not scraped:
            return []

        # Stage 3: persist (best-effort; cache write failures are swallowed).
        await upsert_cooccurrence_batch(
            seed_artist=artist, seed_track=track, pairs=scraped
        )

        return scraped[:limit]

    async def random_techno_track(self) -> TrackMeta | None:
        return None

    # ── scraping internals ────────────────────────────────────────────────

    async def _scrape_with_budget(
        self, artist: str, track: str, budget_s: float
    ) -> list[TrackMeta]:
        deadline = time.monotonic() + budget_s

        async with httpx.AsyncClient(
            timeout=HTTP_TIMEOUT_S,
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        ) as client:
            seed_id = await self._find_seed_id(client, artist, track)
            if not seed_id or time.monotonic() > deadline:
                return []

            await asyncio.sleep(RATE_LIMIT_S)
            set_urls = await self._fetch_set_urls(
                client, seed_id, max_sets=MAX_SETS_PER_SEED
            )
            if not set_urls:
                return []

            cooccur: dict[tuple[str, str], dict] = defaultdict(
                lambda: {"setCount": 0, "url": "", "artist": "", "title": ""}
            )
            for set_url in set_urls:
                if time.monotonic() > deadline:
                    break
                try:
                    pairs = await self._adjacent_tracks(
                        client, set_url, seed_id, window=WINDOW
                    )
                except Exception as e:
                    print(f"[Tracklist1001] set parse failed for {set_url}: {e}")
                    pairs = []
                for p in pairs:
                    key = (p["artist"].lower(), p["title"].lower())
                    bucket = cooccur[key]
                    bucket["setCount"] += 1
                    if not bucket["url"]:
                        bucket["url"] = p["url"]
                        bucket["artist"] = p["artist"]
                        bucket["title"] = p["title"]
                await asyncio.sleep(RATE_LIMIT_S)

        sorted_pairs = sorted(
            cooccur.values(),
            key=lambda x: (-x["setCount"], x["url"]),
        )

        return [
            TrackMeta(
                title=p["title"],
                artist=p["artist"],
                source=self.name,
                sourceUrl=p["url"],
                score=float(p["setCount"]),
            )
            for p in sorted_pairs
        ]

    async def _find_seed_id(
        self, client: httpx.AsyncClient, artist: str, track: str
    ) -> str | None:
        """Search 1001TL and return the trailing slug of the first track result."""
        # Most fragile parser in the adapter: 1001TL search HTML changes.
        # If this returns None for a known seed (e.g. Oscar Mulero - Horses),
        # inspect the live search page in DevTools and update the selector.
        params = {"main_search": f"{artist} {track}", "search_selection": 14}
        try:
            resp = await client.get(SEARCH, params=params)
            resp.raise_for_status()
        except Exception as e:
            print(f"[Tracklist1001] search request failed: {e}")
            return None

        try:
            soup = BeautifulSoup(resp.text, "html.parser")
            link = soup.select_one('a[href^="/track/"]')
            if not link:
                return None
            href = link.get("href", "")
            return href.removeprefix("/track/") or None
        except Exception as e:
            print(f"[Tracklist1001] search parse failed for {artist} - {track}: {e}")
            return None

    async def _fetch_set_urls(
        self, client: httpx.AsyncClient, seed_id: str, max_sets: int
    ) -> list[str]:
        """Seed track page lists DJ sets that played it. Return up to max_sets."""
        url = f"{BASE}/track/{seed_id}"
        try:
            resp = await client.get(url)
            resp.raise_for_status()
        except Exception as e:
            print(f"[Tracklist1001] seed page failed for {seed_id}: {e}")
            return []

        try:
            soup = BeautifulSoup(resp.text, "html.parser")
            seen: set[str] = set()
            urls: list[str] = []
            for link in soup.select('a[href^="/tracklist/"]'):
                href = link.get("href", "")
                if not href:
                    continue
                full = f"{BASE}{href}"
                if full in seen:
                    continue
                seen.add(full)
                urls.append(full)
                if len(urls) >= max_sets:
                    break
            return urls
        except Exception as e:
            print(f"[Tracklist1001] set list parse failed for {seed_id}: {e}")
            return []

    async def _adjacent_tracks(
        self,
        client: httpx.AsyncClient,
        set_url: str,
        seed_id: str,
        window: int,
    ) -> list[dict]:
        """Fetch a DJ set page and return tracks within ±window of the seed."""
        try:
            resp = await client.get(set_url)
            resp.raise_for_status()
        except Exception as e:
            print(f"[Tracklist1001] set fetch failed for {set_url}: {e}")
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        track_rows = soup.select("div.tlpTog")
        tracks_in_set: list[dict] = []
        seen_tids: set[str] = set()
        seed_idx: int | None = None
        for row in track_rows:
            a = row.select_one('a[href^="/track/"]')
            if not a:
                continue
            href = a.get("href", "")
            tid = href.removeprefix("/track/")
            if not tid or tid in seen_tids:
                # 1001TL occasionally lists the seed twice (intro + outro).
                # Dedup within a set so positions stay coherent.
                continue
            artist_node = row.select_one('meta[itemprop="byArtist"]')
            title_node = row.select_one('meta[itemprop="name"]')
            artist_name = (
                artist_node.get("content", "") if artist_node else ""
            ).strip()
            title = (title_node.get("content", "") if title_node else "").strip()
            if not artist_name or not title:
                continue
            tracks_in_set.append({
                "id": tid,
                "artist": artist_name,
                "title": title,
                "url": f"{BASE}{href}",
            })
            seen_tids.add(tid)
            if tid == seed_id:
                seed_idx = len(tracks_in_set) - 1

        if seed_idx is None:
            return []

        start = max(0, seed_idx - window)
        end = min(len(tracks_in_set), seed_idx + window + 1)
        return [t for t in tracks_in_set[start:end] if t["id"] != seed_id]


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
