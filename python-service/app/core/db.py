"""
Direct Postgres access from python-service for tables managed by Prisma.

The Prisma client is JS-only — instead of sharing it, we SELECT/INSERT/UPDATE
against the same Postgres DB using asyncpg. Table and column names match the
Prisma schema exactly; if the schema changes, this file changes too.

Soft-degrades when DATABASE_URL is empty: callers see no rows on read and
no-ops on write, mirroring the project-wide adapter convention.
"""
import asyncio
import json
from datetime import datetime, timedelta

import asyncpg

from app.config import settings
from app.core.models import TrackMeta

_TRACKLIST_BASE = "https://www.1001tracklists.com/track/"
_TRACKID_BASE = "https://www.trackid.net/track/"

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


async def _get_pool() -> asyncpg.Pool | None:
    """Lazy-init asyncpg pool. Returns None when DATABASE_URL is empty."""
    global _pool
    if not settings.database_url:
        return None
    async with _pool_lock:
        if _pool is None:
            _pool = await asyncpg.create_pool(
                settings.database_url,
                min_size=1,
                max_size=5,
            )
    return _pool


def _normalize(s: str) -> str:
    return s.lower().strip()


def _seed_key(artist: str, track: str) -> str:
    return f"{_normalize(artist)}|{_normalize(track)}"


async def fetch_cooccurrence(
    *,
    artist: str,
    track: str,
    ttl_days: int,
    limit: int,
) -> list[TrackMeta]:
    """
    Look up cached co-occurrence for (artist, track), filtered by TTL.

    The seed is identified by an `artist|track` normalized key, written by
    `upsert_cooccurrence_batch` below. Returns rows ordered by setCount desc
    (then pairUrl asc for stable ties), shaped as TrackMeta.
    """
    pool = await _get_pool()
    if pool is None:
        return []

    # The Prisma column is TIMESTAMP(3) WITHOUT TIME ZONE; asyncpg refuses
    # tz-aware values for it. Use a naive UTC instant so the comparison works.
    cutoff = datetime.utcnow() - timedelta(days=ttl_days)
    seed = _seed_key(artist, track)

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT "pairArtist", "pairTitle", "pairUrl", "setCount"
                FROM "TracklistCooccurrence"
                WHERE "seedTracklistId" = $1
                  AND "updatedAt" >= $2
                ORDER BY "setCount" DESC, "pairUrl" ASC
                LIMIT $3
                """,
                seed, cutoff, limit,
            )
    except Exception as e:
        print(f"[Tracklist1001] cache read error: {e}")
        return []

    return [
        TrackMeta(
            title=r["pairTitle"],
            artist=r["pairArtist"],
            source="tracklist1001",
            sourceUrl=r["pairUrl"],
            score=float(r["setCount"]),
        )
        for r in rows
    ]


async def upsert_cooccurrence_batch(
    *,
    seed_artist: str,
    seed_track: str,
    pairs: list[TrackMeta],
) -> None:
    """
    Persist a batch of co-occurrences for a seed.

    setCount in EXCLUDED is the freshly-scraped count, NOT a sum: re-scraping
    a seed replaces the count, since DJ sets shift over time and a 90-day-old
    set should not keep contributing.

    Uses gen_random_uuid()::text for the id column; Prisma's cuid() is
    application-side and not available in Postgres. The column is `String @id`
    without enforced format, so a UUID string is acceptable.
    """
    pool = await _get_pool()
    if pool is None or not pairs:
        return

    seed = _seed_key(seed_artist, seed_track)

    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for p in pairs:
                    pair_id = p.sourceUrl.removeprefix(_TRACKLIST_BASE)
                    await conn.execute(
                        """
                        INSERT INTO "TracklistCooccurrence"
                          (id, "seedTracklistId", "pairTracklistId",
                           "pairArtist", "pairTitle", "pairUrl",
                           "setCount", "createdAt", "updatedAt")
                        VALUES (
                          gen_random_uuid()::text,
                          $1, $2, $3, $4, $5, $6, now(), now()
                        )
                        ON CONFLICT ("seedTracklistId", "pairTracklistId") DO UPDATE
                        SET "setCount" = EXCLUDED."setCount",
                            "updatedAt" = now(),
                            "pairArtist" = EXCLUDED."pairArtist",
                            "pairTitle" = EXCLUDED."pairTitle",
                            "pairUrl" = EXCLUDED."pairUrl"
                        """,
                        seed,
                        pair_id,
                        p.artist,
                        p.title,
                        p.sourceUrl,
                        int(p.score) if p.score else 1,
                    )
    except Exception as e:
        print(f"[Tracklist1001] cache write error: {e}")


async def fetch_trackid_cooccurrence(
    *,
    artist: str,
    track: str,
    ttl_days: int,
    limit: int,
) -> list[TrackMeta]:
    """
    Look up cached co-occurrence for (artist, track) from TrackidCooccurrence.

    Mirror of fetch_cooccurrence (B2): same `artist|track` normalized seed key,
    same TTL filter, same shape of returned TrackMeta. Separate function rather
    than a shared helper so each source can evolve its TTL / source label
    independently — see commit 8314220 for the rationale.
    """
    pool = await _get_pool()
    if pool is None:
        return []

    cutoff = datetime.utcnow() - timedelta(days=ttl_days)
    seed = _seed_key(artist, track)

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT "pairArtist", "pairTitle", "pairUrl", "setCount"
                FROM "TrackidCooccurrence"
                WHERE "seedTrackidId" = $1
                  AND "updatedAt" >= $2
                ORDER BY "setCount" DESC, "pairUrl" ASC
                LIMIT $3
                """,
                seed, cutoff, limit,
            )
    except Exception as e:
        print(f"[Trackidnet] cache read error: {e}")
        return []

    return [
        TrackMeta(
            title=r["pairTitle"],
            artist=r["pairArtist"],
            source="trackidnet",
            sourceUrl=r["pairUrl"],
            score=float(r["setCount"]),
        )
        for r in rows
    ]


async def upsert_trackid_cooccurrence_batch(
    *,
    seed_artist: str,
    seed_track: str,
    pairs: list[TrackMeta],
) -> None:
    """
    Persist a batch of co-occurrences for a seed into TrackidCooccurrence.

    Mirror of upsert_cooccurrence_batch (B2): EXCLUDED.setCount replaces (not
    sums) on conflict so re-scrapes don't double-count, and gen_random_uuid is
    used for the id since cuid() is application-side only.
    """
    pool = await _get_pool()
    if pool is None or not pairs:
        return

    seed = _seed_key(seed_artist, seed_track)

    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for p in pairs:
                    pair_id = p.sourceUrl.removeprefix(_TRACKID_BASE)
                    await conn.execute(
                        """
                        INSERT INTO "TrackidCooccurrence"
                          (id, "seedTrackidId", "pairTrackidId",
                           "pairArtist", "pairTitle", "pairUrl",
                           "setCount", "createdAt", "updatedAt")
                        VALUES (
                          gen_random_uuid()::text,
                          $1, $2, $3, $4, $5, $6, now(), now()
                        )
                        ON CONFLICT ("seedTrackidId", "pairTrackidId") DO UPDATE
                        SET "setCount" = EXCLUDED."setCount",
                            "updatedAt" = now(),
                            "pairArtist" = EXCLUDED."pairArtist",
                            "pairTitle" = EXCLUDED."pairTitle",
                            "pairUrl" = EXCLUDED."pairUrl"
                        """,
                        seed,
                        pair_id,
                        p.artist,
                        p.title,
                        p.sourceUrl,
                        int(p.score) if p.score else 1,
                    )
    except Exception as e:
        print(f"[Trackidnet] cache write error: {e}")


async def fetch_lastfm_artist_similars(
    *,
    artist: str,
    ttl_days: int,
) -> list[dict] | None:
    """
    Look up cached Last.fm artist.getSimilar result for `artist`, filtered by TTL.

    Returns the parsed list of {name, match, url} dicts, or None on miss /
    expired / DB-unavailable / decode error. Returning None signals the caller
    to refetch from the API; an empty cached list (`[]`) is treated as a valid
    cache hit meaning "Last.fm has no similars for this artist", and is
    returned as `[]`, not None.
    """
    pool = await _get_pool()
    if pool is None:
        return None

    cutoff = datetime.utcnow() - timedelta(days=ttl_days)
    seed = _normalize(artist)

    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT "similars"
                FROM "LastfmArtistSimilars"
                WHERE "seedArtist" = $1
                  AND "updatedAt" >= $2
                """,
                seed, cutoff,
            )
    except Exception as e:
        print(f"[Lastfm] artist-similars cache read error: {e}")
        return None

    if row is None:
        return None

    raw = row["similars"]
    # asyncpg returns JSONB as a str by default (no codec registered). Parse it.
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception as e:
            print(f"[Lastfm] artist-similars cache decode error: {e}")
            return None
    if not isinstance(raw, list):
        return None
    return raw


async def upsert_candidate_features_batch(rows: list[dict]) -> None:
    """
    Upsert CandidateFeatures rows for a single search.

    Conflict on (searchQueryId, trackId) replaces existing values — the same
    search shouldn't have inconsistent features for the same candidate, and
    re-running extraction for a search should overwrite cleanly.

    Per ADR-0011 the table tracks observability data, not user-facing state,
    so this function soft-degrades like the other cache writers: missing
    DATABASE_URL or any DB error is logged with the [Features] prefix and
    returns None. Search response is fire-and-forget on this side.

    The id column uses gen_random_uuid()::text — Prisma's cuid() is JS-only
    and the column accepts any unique string (matches the convention in the
    1001TL/trackid cooccurrence writers above).
    """
    if not rows:
        return
    pool = await _get_pool()
    if pool is None:
        return

    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for row in rows:
                    await conn.execute(
                        """
                        INSERT INTO "CandidateFeatures"
                          (id, "searchQueryId", "trackId",
                           "bpmDelta", "keyCompat", "energyDelta",
                           "labelMatch", "genreMatch",
                           "nSources", "topRank", "hasEmbed",
                           "rrfScore", "createdAt")
                        VALUES (
                          gen_random_uuid()::text,
                          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
                        )
                        ON CONFLICT ("searchQueryId", "trackId") DO UPDATE
                        SET "bpmDelta" = EXCLUDED."bpmDelta",
                            "keyCompat" = EXCLUDED."keyCompat",
                            "energyDelta" = EXCLUDED."energyDelta",
                            "labelMatch" = EXCLUDED."labelMatch",
                            "genreMatch" = EXCLUDED."genreMatch",
                            "nSources" = EXCLUDED."nSources",
                            "topRank" = EXCLUDED."topRank",
                            "hasEmbed" = EXCLUDED."hasEmbed",
                            "rrfScore" = EXCLUDED."rrfScore"
                        """,
                        row["searchQueryId"], row["trackId"],
                        row.get("bpmDelta"), row.get("keyCompat"),
                        row.get("energyDelta"),
                        row.get("labelMatch"), row.get("genreMatch"),
                        row["nSources"], row["topRank"], row["hasEmbed"],
                        row["rrfScore"],
                    )
    except Exception as e:
        print(f"[Features] cache write error: {e}")


async def upsert_lastfm_artist_similars(
    *,
    artist: str,
    similars: list[dict],
) -> None:
    """
    Persist Last.fm artist.getSimilar result for `artist` with current timestamp.

    Atomic single-row replace on conflict — artist relationships are slow-moving
    so we always overwrite with the latest fetch rather than merge. Empty lists
    are persisted (a valid "no similars" cache entry) so we don't refetch every
    request for an unknown artist.
    """
    pool = await _get_pool()
    if pool is None:
        return

    seed = _normalize(artist)
    payload = json.dumps(similars)

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "LastfmArtistSimilars"
                  (id, "seedArtist", "similars", "createdAt", "updatedAt")
                VALUES (gen_random_uuid()::text, $1, $2::jsonb, now(), now())
                ON CONFLICT ("seedArtist") DO UPDATE
                SET "similars" = EXCLUDED."similars",
                    "updatedAt" = now()
                """,
                seed, payload,
            )
    except Exception as e:
        print(f"[Lastfm] artist-similars cache write error: {e}")
