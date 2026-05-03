"""
trackid.net adapter — DJ co-occurrence within ±2 positions.

Structurally identical to the 1001tracklists adapter (B2): cache → scrape with
budget → persist → return. See app/adapters/tracklist1001.py for the full
design rationale; what differs here is the source-specific surface:

  - URL pattern is /track/<id> for tracks and /dj/<slug>/<set-slug> for sets
  - selectors match trackid.net's structural class names rather than
    1001TL's microdata
  - distinct User-Agent so a UA ban on one source doesn't take out the other
  - separate TrackidCooccurrence cache table and trackidnet_enabled flag

Like 1001tracklists, ships disabled (settings.trackidnet_enabled = False) until
the parser is verified against live markup. Cache, scraper, and route wiring
stay in place so re-enabling is a one-config change.
"""
import asyncio
import time
from collections import defaultdict

import httpx
from bs4 import BeautifulSoup

from app.adapters.base import AbstractAdapter
from app.config import settings
from app.core.db import (
    fetch_trackid_cooccurrence,
    upsert_trackid_cooccurrence_batch,
)
from app.core.models import TrackMeta

BASE = "https://www.trackid.net"
SEARCH = f"{BASE}/search"
# Distinct UA from tracklist1001 so a ban on one source doesn't take both out.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
HTTP_TIMEOUT_S = 4.0
RATE_LIMIT_S = 1.0
SCRAPE_BUDGET_S = 8.0
MAX_SETS_PER_SEED = 20
WINDOW = 2
TTL_DAYS = 7
DEFAULT_LIMIT = 50


class TrackidnetAdapter(AbstractAdapter):
    name = "trackidnet"

    async def find_similar(
        self, query: str, limit: int = DEFAULT_LIMIT
    ) -> list[TrackMeta]:
        if not settings.trackidnet_enabled:
            return []

        artist, track = _split_query(query)
        if not track:
            return []

        cached = await fetch_trackid_cooccurrence(
            artist=artist, track=track, ttl_days=TTL_DAYS, limit=limit
        )
        if cached:
            return cached

        try:
            scraped = await self._scrape_with_budget(
                artist, track, budget_s=SCRAPE_BUDGET_S
            )
        except Exception as e:
            print(f"[Trackidnet] scrape error: {e}")
            return []

        if not scraped:
            return []

        await upsert_trackid_cooccurrence_batch(
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
                    print(f"[Trackidnet] set parse failed for {set_url}: {e}")
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
        """Search trackid.net and return the trailing slug of the first track result."""
        params = {"query": f"{artist} {track}"}
        try:
            resp = await client.get(SEARCH, params=params)
            resp.raise_for_status()
        except Exception as e:
            print(f"[Trackidnet] search request failed: {e}")
            return None

        try:
            soup = BeautifulSoup(resp.text, "html.parser")
            link = soup.select_one('a[href^="/track/"]')
            if not link:
                return None
            href = link.get("href", "")
            return href.removeprefix("/track/") or None
        except Exception as e:
            print(f"[Trackidnet] search parse failed for {artist} - {track}: {e}")
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
            print(f"[Trackidnet] seed page failed for {seed_id}: {e}")
            return []

        try:
            soup = BeautifulSoup(resp.text, "html.parser")
            seen: set[str] = set()
            urls: list[str] = []
            for link in soup.select('a[href^="/dj/"]'):
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
            print(f"[Trackidnet] set list parse failed for {seed_id}: {e}")
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
            print(f"[Trackidnet] set fetch failed for {set_url}: {e}")
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        # trackid.net's DJ-set HTML uses class-based rows rather than the
        # microdata tags 1001TL exposes.
        track_rows = soup.select("div.set-track")
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
                continue
            artist_node = row.select_one(".track-artist")
            title_node = row.select_one(".track-title")
            artist_name = artist_node.get_text(strip=True) if artist_node else ""
            title = title_node.get_text(strip=True) if title_node else ""
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
