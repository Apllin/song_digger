"""
trackid.net JSON API adapter — playlists-list architecture.

trackid.net is a tracklist-detection site (their bots auto-identify tracks
in DJ sets uploaded to SoundCloud / Mixcloud / YouTube). Their data is
exposed via /api/public/... endpoints — JSON, no auth required, no
Cloudflare challenges on these paths.

Three endpoints used:
  GET /api/public/musictracks?keywords=<q>             — search/seed lookup
  GET /api/public/audiostreams?musicTrackId=<id>       — list ALL playlists
                                                          where a track played
                                                          (lightweight, no
                                                          tracklists in payload)
  GET /api/public/audiostreams/<slug>                  — full tracklist for
                                                          one playlist

Flow per seed:
  1. Search → pick best catalogue entry (exact-artist match w/ highest
     playCount; fall back to first nonzero-playCount). Capture the seed
     `id` (numeric, used by step 2) and `slug` (string, used by step 4
     to anchor the window).
  2. List playlists for the seed id. Sort by `addedOn` desc and take the
     first MAX_PLAYLISTS — fresher sets are more representative of the
     track's current DJ context.
  3. Fetch each playlist's full tracklist concurrently with a
     DETAIL_CONCURRENCY-bound semaphore. Soft-fail per fetch.
  4. For each playlist: pick the most recent NON-EMPTY detection process
     by endDate (sets get reprocessed; empty reprocesses can mask older
     real data). Find the seed track in the tracklist by slug; take the
     ±WINDOW tracks around the first occurrence (5 before, 5 after),
     excluding every instance of the seed slug.
  5. Aggregate every non-seed track across all extracted windows by slug.
     Co-occurrence count = number of playlists the candidate appears in.
     Sort by count desc, then `referenceCount` asc — globally less-generic
     tracks win the tiebreak among equal counts.
  6. Map to TrackMeta and return up to `limit`.

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
PLAYLISTS_PAGE_SIZE = 20
WINDOW = 5
MAX_PLAYLISTS = 15
DETAIL_CONCURRENCY = 5
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
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Referer": "https://trackid.net/",
            },
        ) as client:
            seed = await _find_seed_track(client, artist, track)
            if not seed or seed.get("id") is None:
                return []

            playlist_slugs = await _list_playlists(client, seed["id"])
            if not playlist_slugs:
                return []

            tracklists = await _fetch_tracklists(client, playlist_slugs)

        seed_slug = seed.get("slug") or ""
        coocc: dict[str, dict[str, Any]] = {}
        for audiostream in tracklists:
            for tr in _extract_window(audiostream, seed_slug, WINDOW):
                slug = tr.get("slug")
                if not slug:
                    continue
                rec = coocc.get(slug)
                if rec is None:
                    coocc[slug] = {"track": tr, "count": 1}
                else:
                    rec["count"] += 1

        ranked = sorted(
            coocc.values(),
            key=lambda r: (-r["count"], r["track"].get("referenceCount") or 9999),
        )

        return [_to_track_meta(r["track"], float(r["count"])) for r in ranked[:limit]]


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

    Returns the full record so callers can read both `id` (used to list
    playlists) and `slug` (used to anchor the window inside each tracklist).

    Caveat: when a query matches both an original and a remix, the picker
    takes the higher playCount. If the user wanted the remix but the
    original is more played, candidates will be drawn from the original's
    sets. Acceptable for v1.
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


async def _list_playlists(
    client: httpx.AsyncClient, music_track_id: int
) -> list[str]:
    """Return up to MAX_PLAYLISTS audiostream slugs for the given music
    track id, sorted by addedOn descending (freshest first).

    The /audiostreams?musicTrackId= endpoint returns lightweight metadata
    only (no tracklists in the payload), so this call is cheap. We don't
    paginate — the first page (pageSize=20) is enough; if a track has more
    than 20 known sets, the freshest 20 are sufficient context for
    co-occurrence and we cap at 15 of those anyway.
    """
    try:
        resp = await client.get(
            f"{API_BASE}/audiostreams",
            params={
                "musicTrackId": music_track_id,
                "pageSize": PLAYLISTS_PAGE_SIZE,
                "currentPage": 0,
                "sortField": "",
                "sortDirection": "",
            },
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        print(f"[Trackidnet] playlists list failed for {music_track_id}: {e}")
        return []

    streams = (data.get("result") or {}).get("audiostreams") or []
    if not streams:
        return []

    # Defensive sort — the API tends to return addedOn desc but we
    # don't want to depend on that contract.
    streams_sorted = sorted(
        streams, key=lambda s: s.get("addedOn") or "", reverse=True
    )
    slugs: list[str] = []
    for s in streams_sorted:
        slug = s.get("slug")
        if slug and slug not in slugs:
            slugs.append(slug)
        if len(slugs) >= MAX_PLAYLISTS:
            break
    return slugs


async def _fetch_tracklists(
    client: httpx.AsyncClient, slugs: list[str]
) -> list[dict]:
    """Fetch each /audiostreams/<slug> concurrently, bounded by a
    semaphore so we don't open MAX_PLAYLISTS sockets at once and look
    like a scraper from trackid's side. Failed fetches drop out silently.
    """
    sem = asyncio.Semaphore(DETAIL_CONCURRENCY)

    async def _one(slug: str) -> dict | None:
        async with sem:
            try:
                resp = await client.get(f"{API_BASE}/audiostreams/{slug}")
                resp.raise_for_status()
                return (resp.json() or {}).get("result")
            except (httpx.HTTPError, ValueError) as e:
                print(f"[Trackidnet] audiostream {slug} failed: {e}")
                return None

    results = await asyncio.gather(*(_one(s) for s in slugs))
    return [r for r in results if r is not None]


def _extract_window(
    audiostream: dict, seed_slug: str, window: int
) -> list[dict]:
    """Return up to `window` tracks before and `window` after the first
    occurrence of `seed_slug` in this playlist's tracklist, excluding
    every instance of the seed itself.

    Process selection: we pick the latest by endDate among processes
    THAT CONTAIN THE SEED SLUG. Sets get reprocessed and not all tracks
    are detected on every pass — the same playlist can have a later
    non-empty process that simply lost the seed. Picking by "latest
    non-empty" silently drops these playlists; anchoring on "contains
    seed" is the only reliable signal that a process is usable for
    co-occurrence around this seed. If no process contains the seed,
    the playlist contributes nothing (we cannot place the window).

    Edge cases:
      - No process contains the seed → []
      - Seed at position 0 → only `window` tracks after (no before)
      - Seed at last position → only `window` tracks before (no after)
      - Seed appears multiple times in chosen process → anchor on first
        occurrence; all instances of the seed slug are filtered from
        the returned window
    """
    processes = audiostream.get("detectionProcesses") or []
    with_seed = [
        p for p in processes
        if any(
            t.get("slug") == seed_slug
            for t in (p.get("detectionProcessMusicTracks") or [])
        )
    ]
    if not with_seed:
        return []

    chosen = max(with_seed, key=lambda p: p.get("endDate") or "")
    tracks = chosen.get("detectionProcessMusicTracks") or []
    seed_idx = next(
        i for i, t in enumerate(tracks) if t.get("slug") == seed_slug
    )

    start = max(0, seed_idx - window)
    end = min(len(tracks), seed_idx + window + 1)
    return [t for t in tracks[start:end] if t.get("slug") != seed_slug]


def _to_track_meta(track: dict, score: float) -> TrackMeta:
    slug = track.get("slug") or ""
    artwork = (track.get("artworkUrl") or "").strip() or None
    return TrackMeta(
        title=(track.get("title") or "").strip(),
        artist=(track.get("artist") or "").strip(),
        source=TrackidnetAdapter.SOURCE,
        sourceUrl=f"https://trackid.net/musictracks/{slug}" if slug else "",
        coverUrl=artwork,
        score=score,
    )
