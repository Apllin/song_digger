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
