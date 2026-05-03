"""
trackid.net JSON API adapter.

trackid.net is a tracklist-detection site (their bots auto-identify tracks
in DJ sets uploaded to SoundCloud / Mixcloud / YouTube). Their data is
exposed via /api/public/... endpoints — JSON, no auth required, no
Cloudflare challenges on these paths.

Flow for a seed track:
  1. /musictracks?keywords=<artist track> → pick the best matching seed
     (exact-artist match with highest playCount; fall back to first
     nonzero-playCount entry).
  2. The seed record carries minCreatedSlug + maxCreatedSlug — the earliest
     and latest known DJ-set audiostreams that played it.
  3. /audiostreams/<slug> → tracklist for each of those sets. Use the most
     recent detectionProcess (sets get reprocessed; later runs supersede).
  4. Aggregate every non-seed track across both tracklists by slug.
     Co-occurrence count = number of fetched sets the candidate appears in
     (1 or 2). Sort by count desc, then by referenceCount asc — tracks
     that travel with the seed but aren't globally ubiquitous rank first.

Soft-degrades: any HTTP error, JSON parse error, or missing seed returns [].
Never raises into the caller (per python-adapter-pattern).
"""
import asyncio
from typing import Any

import httpx

from app.adapters.base import AbstractAdapter
from app.config import settings
from app.core.models import TrackMeta

API_BASE = "https://trackid.net/api/public"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
TIMEOUT_SECONDS = 8.0
SEARCH_PAGE_SIZE = 20
DEFAULT_LIMIT = 50


class TrackidnetAdapter(AbstractAdapter):
    SOURCE = "trackidnet"

    async def find_similar(
        self, query: str, limit: int = DEFAULT_LIMIT
    ) -> list[TrackMeta]:
        if not settings.trackidnet_enabled:
            return []

        artist, track = _split_query(query)
        if not track:
            return []

        async with httpx.AsyncClient(
            timeout=TIMEOUT_SECONDS,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        ) as client:
            seed = await _find_seed_track(client, artist, track)
            if not seed:
                return []

            audiostream_slugs = _collect_audiostream_slugs(seed)
            if not audiostream_slugs:
                return []

            tracklists = await _fetch_tracklists(client, audiostream_slugs)

        seed_slug = seed.get("slug") or ""
        coocc: dict[str, dict[str, Any]] = {}
        for audiostream in tracklists:
            for tr in _extract_tracks(audiostream, seed_slug):
                slug = tr.get("slug")
                if not slug:
                    continue
                rec = coocc.get(slug)
                if rec is None:
                    coocc[slug] = {"track": tr, "count": 1}
                else:
                    rec["count"] += 1

        # Higher co-occurrence first; among ties, prefer lower
        # referenceCount (less globally generic) — tracks with no
        # referenceCount at all rank last via the 9999 sentinel.
        ranked = sorted(
            coocc.values(),
            key=lambda r: (-r["count"], r["track"].get("referenceCount") or 9999),
        )

        return [_to_track_meta(r["track"], float(r["count"])) for r in ranked[:limit]]

    async def random_techno_track(self) -> TrackMeta | None:
        return None


# ── helpers ───────────────────────────────────────────────────────────────

def _split_query(query: str) -> tuple[str, str | None]:
    """Parse "Artist - Track" → (artist, track). Returns (query, None) when
    no separator. Adapters needing a track must short-circuit on (artist, None)."""
    if " - " not in query:
        return query.strip(), None
    artist, _, track = query.partition(" - ")
    artist = artist.strip()
    track = track.strip()
    if not track:
        return artist, None
    return artist, track


async def _find_seed_track(
    client: httpx.AsyncClient, artist: str, track: str
) -> dict | None:
    """Pick the best catalogue entry for (artist, track) from /musictracks.

    Picker: exact artist match (case-insensitive) with highest playCount;
    fall back to the first entry that has any plays at all. Tracks with
    playCount=0 carry no co-occurrence signal and are skipped.

    Caveat (documented in commit message and in the spec): when a query
    matches both an original and a remix, the picker takes the higher
    playCount. If the user wanted the remix but the original is more
    played, candidates will be drawn from the original's sets.
    """
    keywords = f"{artist} {track}".strip()
    try:
        resp = await client.get(
            f"{API_BASE}/musictracks",
            params={
                "keywords": keywords,
                "pageSize": SEARCH_PAGE_SIZE,
                "currentPage": 0,
                "sortField": "",
                "sortDirection": "",
            },
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        print(f"[Trackidnet] search failed for {keywords!r}: {e}")
        return None

    results = (data.get("result") or {}).get("musicTracks") or []
    if not results:
        return None

    artist_lc = artist.lower()
    with_artist = [
        r for r in results
        if (r.get("artist") or "").lower() == artist_lc
        and (r.get("playCount") or 0) > 0
    ]
    if with_artist:
        return max(with_artist, key=lambda r: r.get("playCount") or 0)

    nonzero = [r for r in results if (r.get("playCount") or 0) > 0]
    if nonzero:
        return nonzero[0]

    return None


def _collect_audiostream_slugs(seed: dict) -> list[str]:
    """Earliest and latest known sets for this seed; deduplicate when the
    track has only one play (min == max)."""
    slugs: list[str] = []
    for key in ("minCreatedSlug", "maxCreatedSlug"):
        s = seed.get(key)
        if s and s not in slugs:
            slugs.append(s)
    return slugs


async def _fetch_tracklists(
    client: httpx.AsyncClient, slugs: list[str]
) -> list[dict]:
    """Fetch each audiostream concurrently. Failed fetches drop out silently."""
    async def _one(slug: str) -> dict | None:
        try:
            resp = await client.get(f"{API_BASE}/audiostreams/{slug}")
            resp.raise_for_status()
            return (resp.json() or {}).get("result")
        except (httpx.HTTPError, ValueError) as e:
            print(f"[Trackidnet] audiostream {slug} failed: {e}")
            return None

    results = await asyncio.gather(*(_one(s) for s in slugs))
    return [r for r in results if r is not None]


def _extract_tracks(audiostream: dict, seed_slug: str) -> list[dict]:
    """Every track from the most-recent detection process, with the seed
    filtered out (matched by slug, all instances if it appears more than once).

    Sets get reprocessed over time; later runs may add or correct tracks.
    Mixing tracks across processes would double-count, so we use only the
    process with the latest endDate. ISO-8601 timestamps sort correctly
    lexicographically.
    """
    processes = audiostream.get("detectionProcesses") or []
    if not processes:
        return []

    latest = max(processes, key=lambda p: p.get("endDate") or "")
    tracks = latest.get("detectionProcessMusicTracks") or []
    if not tracks:
        return []

    return [t for t in tracks if t.get("slug") != seed_slug]


def _to_track_meta(track: dict, score: float) -> TrackMeta:
    slug = track.get("slug") or ""
    return TrackMeta(
        title=(track.get("title") or "").strip(),
        artist=(track.get("artist") or "").strip(),
        source=TrackidnetAdapter.SOURCE,
        sourceUrl=f"https://trackid.net/musictracks/{slug}" if slug else "",
        score=score,
    )
