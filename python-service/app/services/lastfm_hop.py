"""
Last.fm hop expansion — multi-seed artist-similarity fan-out.

Used by /similar to widen the candidate pool beyond what direct similarity
sources (cosine, ytm, lastfm track.getSimilar) return. Streaming
recommenders cluster around the same heavy hits for any given artist; the
hop reaches a layer deeper by:

  1. Taking N seed artists (typically the query artist + top artists from
     trackid co-occurrence output)
  2. For each seed: artist.getSimilar → up to HOP_SIMILARS_PER_SEED new
     similar artists, skipping anyone already seen across the whole hop
     (so the same Hadone doesn't show up via Kr!z and Amotik both)
  3. For each new similar artist: one top track, sampled from positions
     2..5 — top-1 of a niche artist is usually their one viral hit, the
     exact thing we want to avoid for a "digging" feel

Output is a flat list of TrackMeta tagged source="lastfm_hop", scored by
the seed→similar match value so the web aggregator's RRF treats stronger
similarity links higher. Soft-degrades to [] on any error.

Latency budget (cold cache): ~6 artist.getSimilar in parallel (~300ms)
+ ~18 artist.getTopTracks via Semaphore(5), ~4 rounds × 200ms = ~800ms.
Warm cache: ~100ms (asyncpg pool reads only).
"""
import asyncio
import random
from typing import Iterable

from app.adapters.lastfm import LastfmAdapter
from app.core.models import TrackMeta

HOP_SIMILARS_PER_SEED = 3
HOP_TOP_TRACK_CONCURRENCY = 5
# Pick a track at a random position in this 0-indexed range (inclusive),
# clamped to the actual list length. Skipping position 0 dodges the
# "one viral hit" failure mode for niche artists.
HOP_TRACK_PICK_MIN = 1
HOP_TRACK_PICK_MAX = 4

_HOP_SOURCE = "lastfm_hop"


async def expand_via_similar_artists(
    seed_artists: list[str],
    *,
    exclude_artists: Iterable[str] = (),
    lastfm: LastfmAdapter | None = None,
) -> list[TrackMeta]:
    """Expand `seed_artists` into a list of tracks by similar-but-unseen
    artists. `exclude_artists` is added to the global seen-set so the hop
    won't surface artists already represented in callers' other source
    lists (e.g. trackid output)."""
    if not seed_artists:
        return []

    adapter = lastfm or LastfmAdapter()
    seen: set[str] = {_norm(a) for a in exclude_artists}
    seen.update(_norm(a) for a in seed_artists)

    similars_lists = await asyncio.gather(
        *(adapter.get_artist_similars(a) for a in seed_artists),
        return_exceptions=True,
    )

    selected: list[dict] = []
    for sims in similars_lists:
        if isinstance(sims, Exception) or not sims:
            continue
        picked = 0
        for s in sims:
            name = (s.get("name") or "").strip()
            key = _norm(name)
            if not key or key in seen:
                continue
            seen.add(key)
            try:
                match = float(s.get("match", 0))
            except (TypeError, ValueError):
                match = 0.0
            selected.append({"name": name, "match": match})
            picked += 1
            if picked >= HOP_SIMILARS_PER_SEED:
                break

    if not selected:
        return []

    sem = asyncio.Semaphore(HOP_TOP_TRACK_CONCURRENCY)

    async def _one(art: dict) -> tuple[dict, list[dict]]:
        async with sem:
            tracks = await adapter.get_artist_top_tracks(art["name"])
            return art, tracks

    fetched = await asyncio.gather(
        *(_one(a) for a in selected), return_exceptions=True
    )

    out: list[TrackMeta] = []
    for entry in fetched:
        if isinstance(entry, Exception):
            continue
        art, tracks = entry
        track = _pick_track(tracks)
        if track is None:
            continue
        title = (track.get("name") or "").strip()
        artist_name = _track_artist_name(track)
        url = (track.get("url") or "").strip()
        if not title or not artist_name or not url:
            continue
        out.append(
            TrackMeta(
                title=title,
                artist=artist_name,
                source=_HOP_SOURCE,
                sourceUrl=url,
                score=art["match"],
            )
        )
    return out


def _pick_track(tracks: list[dict]) -> dict | None:
    """Random pick from positions [HOP_TRACK_PICK_MIN..HOP_TRACK_PICK_MAX],
    clamped to available list length. Falls back to position 0 only when
    the artist has a single top track."""
    if not tracks:
        return None
    max_idx = min(HOP_TRACK_PICK_MAX, len(tracks) - 1)
    min_idx = min(HOP_TRACK_PICK_MIN, max_idx)
    if max_idx <= min_idx:
        return tracks[max_idx]
    return tracks[random.randint(min_idx, max_idx)]


def _track_artist_name(track: dict) -> str:
    artist_obj = track.get("artist")
    if isinstance(artist_obj, dict):
        return (artist_obj.get("name") or "").strip()
    return (artist_obj or "").strip() if isinstance(artist_obj, str) else ""


def _norm(s: str) -> str:
    return s.lower().strip()
