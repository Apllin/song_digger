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
  3. Fetch playlist tracklists in DETAIL_CONCURRENCY-sized batches, stopping
     once EARLY_STOP_TRACK_COUNT unique tracks are collected. Soft-fail per fetch.
  4. For each playlist: pick the most recent NON-EMPTY detection process
     by endDate (sets get reprocessed; empty reprocesses can mask older
     real data). Find the seed track in the tracklist by slug; take the
     ±WINDOW tracks around the first occurrence (2 before, 2 after),
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
from typing import Any, Callable

import httpx

from app.adapters.base import AbstractAdapter
from app.core.models import ParsedQuery, TrackMeta

API_BASE = "https://trackid.net/api/public"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
TIMEOUT_SECONDS = 8.0
SEARCH_PAGE_SIZE = 20
PLAYLISTS_PAGE_SIZE = 20
WINDOW = 2
MAX_PLAYLISTS = 10
DETAIL_CONCURRENCY = 5
# Stop fetching playlists once the co-occurrence pool hits this many tracks.
EARLY_STOP_TRACK_COUNT = 50
DEFAULT_LIMIT = 50
# Artist-only (keyword) flow: query audiostreams by keyword to find playlists
# where the artist appears, then anchor on the artist's tracks inside each
# tracklist. Smaller than MAX_PLAYLISTS because each playlist contributes more
# anchors (typically 2-3 tracks by the queried artist), yielding ~15 unique
# adjacent artists in the aggregated output.
MAX_KEYWORD_PLAYLISTS = 10


class TrackidnetAdapter(AbstractAdapter):
    SOURCE = "trackidnet"

    async def find_similar(
        self, query: ParsedQuery, limit: int = DEFAULT_LIMIT
    ) -> list[TrackMeta]:
        artist, track = query.artist, query.track
        if not artist:
            return []
        if not track:
            return await self._find_by_artist_keyword(artist, limit)

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

            # Use slug, not id, as the lookup key — trackid.net's
            # /audiostreams?musicTrackId=… index does not surface every
            # detected playlist for niche tracks (TRA-19), whereas the
            # ?musicTrackSlug=… query does.
            seed_slug = seed.get("slug") or ""
            playlist_slugs = await _list_playlists(client, seed_slug)
            if not playlist_slugs:
                return []

            coocc = await _aggregate_incrementally(
                client,
                playlist_slugs,
                lambda a: _extract_window(a, seed_slug, WINDOW),
            )

        ranked = sorted(
            coocc.values(),
            key=lambda r: (-r["count"], r["track"].get("referenceCount") or 9999),
        )

        return [_to_track_meta(r["track"], float(r["count"])) for r in ranked[:limit]]

    async def _find_by_artist_keyword(
        self, artist: str, limit: int
    ) -> list[TrackMeta]:
        """Artist-only flow: /audiostreams?keywords=<artist> → playlists where
        the artist plays. In each playlist's tracklist, every track by the
        artist is an anchor; we take ±WINDOW around each (excluding the
        artist's own tracks) and aggregate by co-occurrence across the
        union of playlists. Yields ~15+ unique adjacent artists for a
        typical DJ — the audience the user wants to discover."""
        artist_lc = artist.lower().strip()
        if not artist_lc:
            return []

        async with httpx.AsyncClient(
            timeout=TIMEOUT_SECONDS,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Referer": "https://trackid.net/",
            },
        ) as client:
            slugs = await _search_audiostreams_by_keyword(client, artist)
            if not slugs:
                return []

            slugs = slugs[:MAX_KEYWORD_PLAYLISTS]
            coocc = await _aggregate_incrementally(
                client,
                slugs,
                lambda a: _extract_playlist_tracks_excluding_artist(a, artist_lc),
            )

        ranked = sorted(
            coocc.values(),
            key=lambda r: (-r["count"], r["track"].get("referenceCount") or 9999),
        )
        return [_to_track_meta(r["track"], float(r["count"])) for r in ranked[:limit]]


# ── helpers ───────────────────────────────────────────────────────────────

async def _find_seed_track(
    client: httpx.AsyncClient, artist: str, track: str
) -> dict | None:
    """Pick the best catalogue entry for (artist, track) from /musictracks.

    Picker: exact artist match (case-insensitive), tie-broken by playCount.
    `playCount` on /musictracks is NOT the count of detected sets — it
    reflects something else (player listens or favourites) and is often 0
    for tracks that have plenty of real detections. We verify presence in
    DJ sets at the next step via _list_playlists() instead of filtering
    here, so niche tracks with playCount=0 are not silently dropped.

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
    ]
    if with_artist:
        return max(with_artist, key=lambda r: r.get("playCount") or 0)

    return results[0]


async def _list_playlists(
    client: httpx.AsyncClient, music_track_slug: str
) -> list[str]:
    """Return up to MAX_PLAYLISTS audiostream slugs for the given music
    track slug, sorted by addedOn descending (freshest first).

    Uses `musicTrackSlug` (not `musicTrackId`) — empirically, the id-keyed
    index on trackid.net's public API misses associations for niche tracks
    that the slug-keyed index does surface (TRA-19).

    The /audiostreams?musicTrackSlug= endpoint returns lightweight metadata
    only (no tracklists in the payload), so this call is cheap. We don't
    paginate — the first page (pageSize=20) is enough; we cap at
    MAX_PLAYLISTS of those, taking the freshest by addedOn.
    """
    if not music_track_slug:
        return []
    try:
        resp = await client.get(
            f"{API_BASE}/audiostreams",
            params={
                "musicTrackSlug": music_track_slug,
                "pageSize": PLAYLISTS_PAGE_SIZE,
                "currentPage": 0,
                "sortField": "",
                "sortDirection": "",
            },
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        print(f"[Trackidnet] playlists list failed for {music_track_slug!r}: {e}")
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


async def _aggregate_incrementally(
    client: httpx.AsyncClient,
    slugs: list[str],
    extract: Callable[[dict], list[dict]],
) -> dict[str, dict[str, Any]]:
    """Fetch tracklists in DETAIL_CONCURRENCY-sized batches, aggregating
    co-occurrence as we go. Stops once EARLY_STOP_TRACK_COUNT unique tracks
    are collected, leaving the remaining playlists unrequested."""
    coocc: dict[str, dict[str, Any]] = {}
    for i in range(0, len(slugs), DETAIL_CONCURRENCY):
        tracklists = await _fetch_tracklists(client, slugs[i:i + DETAIL_CONCURRENCY])
        for audiostream in tracklists:
            for tr in extract(audiostream):
                slug = tr.get("slug")
                if not slug:
                    continue
                rec = coocc.get(slug)
                if rec is None:
                    coocc[slug] = {"track": tr, "count": 1}
                else:
                    rec["count"] += 1
        if len(coocc) >= EARLY_STOP_TRACK_COUNT:
            break
    return coocc


def _extract_window(
    audiostream: dict, seed_slug: str, window: int
) -> list[dict]:
    """Return tracks adjacent to `seed_slug` in this playlist. Two paths:

    1) Standard window: pick the latest-by-endDate process that contains the
       seed AND has ≥2 tracks (seed + at least one neighbor). Take ±window
       around the seed position, exclude the seed.

    2) Solo-seed fallback: if the seed only appears in processes that
       contain ONLY the seed (no neighbors detected in that pass), use the
       LARGEST detection process of the playlist as full-playlist context.
       Rationale: the playlist IS known to contain the seed (per the
       `/audiostreams?musicTrackId=` lookup that surfaced it), and all
       processes describe re-detection passes over the SAME audio. The
       largest process is the most complete tracklist of the same DJ set;
       even though that pass didn't identify the seed itself, its other
       tracks are valid neighbors. Without this fallback, playlists where
       the seed lives in a "solo" reprocess silently contribute nothing
       and we lose real DJ context.

    Edge cases:
      - No process contains the seed → []
      - Seed-with-neighbors process exists → window path (case 1)
      - Seed only in solo processes → largest-process path (case 2)
      - Seed at position 0 → only `window` tracks after (no before)
      - Seed appears multiple times in chosen process → anchor on first
        occurrence; all instances of the seed slug are filtered out
    """
    processes = audiostream.get("detectionProcesses") or []
    non_empty = [
        p for p in processes
        if p.get("detectionProcessMusicTracks")
    ]
    if not non_empty:
        return []

    with_seed = [
        p for p in non_empty
        if any(
            t.get("slug") == seed_slug
            for t in (p.get("detectionProcessMusicTracks") or [])
        )
    ]
    if not with_seed:
        return []

    with_seed_substantive = [
        p for p in with_seed
        if len(p.get("detectionProcessMusicTracks") or []) >= 2
    ]
    if with_seed_substantive:
        chosen = max(with_seed_substantive, key=lambda p: p.get("endDate") or "")
        tracks = chosen.get("detectionProcessMusicTracks") or []
        seed_idx = next(
            i for i, t in enumerate(tracks) if t.get("slug") == seed_slug
        )
        start = max(0, seed_idx - window)
        end = min(len(tracks), seed_idx + window + 1)
        return [t for t in tracks[start:end] if t.get("slug") != seed_slug]

    # Solo-seed fallback — use largest process as full-playlist context.
    largest = max(
        non_empty, key=lambda p: len(p.get("detectionProcessMusicTracks") or [])
    )
    tracks = largest.get("detectionProcessMusicTracks") or []
    return [t for t in tracks if t.get("slug") != seed_slug]


async def _search_audiostreams_by_keyword(
    client: httpx.AsyncClient, keyword: str
) -> list[str]:
    """Find audiostream slugs by keyword (typically an artist name). Returns
    slugs sorted by addedOn desc — freshest sets give the most current DJ
    context. Payload is intentionally lightweight: full tracklists come
    from /audiostreams/<slug> calls downstream."""
    try:
        resp = await client.get(
            f"{API_BASE}/audiostreams",
            params={
                "keywords": keyword,
                "pageSize": PLAYLISTS_PAGE_SIZE,
                "currentPage": 0,
                "sortField": "",
                "sortDirection": "",
            },
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        print(f"[Trackidnet] keyword search failed for {keyword!r}: {e}")
        return []

    streams = (data.get("result") or {}).get("audiostreams") or []
    if not streams:
        return []
    streams_sorted = sorted(
        streams, key=lambda s: s.get("addedOn") or "", reverse=True
    )
    out: list[str] = []
    seen: set[str] = set()
    for s in streams_sorted:
        slug = s.get("slug")
        if slug and slug not in seen:
            seen.add(slug)
            out.append(slug)
    return out


def _extract_playlist_tracks_excluding_artist(
    audiostream: dict, artist_lc: str
) -> list[dict]:
    """Return every track from the largest non-empty detection process, except
    those by the queried artist (largest, not latest — trackid reprocesses
    sets, and a fresh reprocess is often a partial detection). Rationale for
    keyword flow: when keyword
    matches a DJ, their playlists are *their selections* — the artist
    themselves rarely appears as a tracklist entry. Anchor-window logic
    (which depends on finding the artist's own tracks inside the set) fails;
    "all tracks in the set" is the right semantic for "tracks this DJ plays".
    Slug-deduped within the playlist; cross-playlist aggregation by slug
    upstream gives natural co-occurrence weighting."""
    processes = audiostream.get("detectionProcesses") or []
    non_empty = [
        p for p in processes
        if p.get("detectionProcessMusicTracks")
    ]
    if not non_empty:
        return []
    chosen = max(non_empty, key=lambda p: len(p.get("detectionProcessMusicTracks") or []))
    tracks = chosen.get("detectionProcessMusicTracks") or []

    out: list[dict] = []
    seen_slugs: set[str] = set()
    for t in tracks:
        if artist_lc in (t.get("artist") or "").lower():
            continue
        slug = t.get("slug")
        if not slug or slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        out.append(t)
    return out


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
