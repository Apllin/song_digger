"""
Direct Postgres access from python-service for tables managed by Prisma.

The Prisma client is JS-only — instead of sharing it, we SELECT/INSERT/UPDATE
against the same Postgres DB using asyncpg. Table and column names match the
Prisma schema exactly; if the schema changes, this file changes too.

Soft-degrades when DATABASE_URL is empty: callers see no rows on read and
no-ops on write, mirroring the project-wide adapter convention.
"""
import asyncio
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
