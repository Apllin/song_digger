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
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()
_pool_init_failed = False  # gates repeated soft-degrade logs during an outage


async def _get_pool() -> asyncpg.Pool | None:
    """Lazy-init asyncpg pool. Returns None when DATABASE_URL is empty OR the
    connection can't be established.

    `create_pool(min_size=1)` connects eagerly, so a DB outage / cold-start /
    SSL-config error raises here — before any guarded query block. Left
    unguarded it propagates through every db helper and silently wipes a whole
    source in the /similar fan-out (Last.fm fallback, trackid.net, lastfm hop).
    Catch it and soft-degrade exactly as for an empty DATABASE_URL; `_pool`
    stays None so the next request retries once the DB is reachable again."""
    global _pool, _pool_init_failed
    if not settings.database_url:
        return None
    async with _pool_lock:
        if _pool is None:
            try:
                _pool = await asyncpg.create_pool(
                    settings.database_url,
                    min_size=1,
                    max_size=5,
                )
                _pool_init_failed = False
            except Exception as e:
                # Log once per outage, not once per cache call — a single
                # /similar fan-out calls this many times.
                if not _pool_init_failed:
                    print(f"[db] pool init failed, soft-degrading: {e}")
                    _pool_init_failed = True
                return None
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

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=ttl_days)
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


# ── Generic external-API cache ──────────────────────────────────────────────
# Mirrors web/lib/external-api-cache.ts. Both modules read/write the same
# ExternalApiCache table. Discogs/Trackidnet/MusicBrainz callers in
# this service use these helpers; iTunes covers (web-only) use the TS twin.
#
# Log format is kept identical across both languages so a single grep covers
# both: `[cache] HIT|MISS|STALE source=X key=Y ...`.

def _log_cache_event(
    outcome: str,
    source: str,
    cache_key: str,
    extra: dict[str, Any],
) -> None:
    parts = [f"outcome={outcome}", f"source={source}", f"key={cache_key}"]
    parts.extend(f"{k}={v}" for k, v in extra.items())
    print(f"[cache] {' '.join(parts)}")


async def fetch_external_cache(
    *,
    source: str,
    cache_key: str,
    ttl_seconds: int | None = None,
) -> Any:
    """
    Look up a cached external-API payload.

    Returns the parsed payload on hit (including empty `[]` / `{}` —
    those are legitimate cache values, not misses). Returns None on:
      - row not found
      - row older than ttl_seconds (when ttl_seconds is not None)
      - DB unavailable / read error
      - JSON decode error

    `ttl_seconds=None` means "never expires" — used for Discogs tracklist
    payloads.

    Cache outages must never block the caller from making the live external
    request; we soft-degrade on every error path.
    """
    if not source or not cache_key:
        return None

    pool = await _get_pool()
    if pool is None:
        return None

    start = time.monotonic()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT "payload", "updatedAt"
                FROM "ExternalApiCache"
                WHERE "source" = $1 AND "cacheKey" = $2
                """,
                source, cache_key,
            )
    except Exception as e:
        print(f"[cache] lookup failed source={source} key={cache_key}: {e}")
        return None

    latency_ms = int((time.monotonic() - start) * 1000)

    if row is None:
        _log_cache_event("MISS", source, cache_key, {"latency_ms": latency_ms})
        return None

    if ttl_seconds is not None:
        # Prisma writes "updatedAt" as TIMESTAMP(3) WITHOUT TIME ZONE in UTC,
        # so compare against naive UTC. utcnow() is deprecated in 3.12+ —
        # use tz-aware now(UTC) and strip tzinfo so subtraction works
        # against the naive DB column.
        now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
        age_s = int((now_naive - row["updatedAt"]).total_seconds())
        if age_s > ttl_seconds:
            _log_cache_event(
                "STALE", source, cache_key,
                {"age_s": age_s, "ttl_s": ttl_seconds, "latency_ms": latency_ms},
            )
            return None
        _log_cache_event(
            "HIT", source, cache_key,
            {"age_s": age_s, "latency_ms": latency_ms},
        )
    else:
        _log_cache_event("HIT", source, cache_key, {"latency_ms": latency_ms})

    raw = row["payload"]
    # asyncpg returns JSONB as a str by default (no codec registered).
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception as e:
            print(f"[cache] decode error source={source} key={cache_key}: {e}")
            return None
    return raw


async def upsert_external_cache(
    *,
    source: str,
    cache_key: str,
    payload: Any,
) -> None:
    """
    Persist an external-API payload. Always overwrites prior content for
    (source, cacheKey) — Postgres' updatedAt-via-trigger isn't on this table,
    so we set it explicitly on each upsert. That's what the TS twin's
    @updatedAt-bump produces, and what the staleness check on the read path
    keys off.
    """
    if not source or not cache_key:
        return

    pool = await _get_pool()
    if pool is None:
        return

    serialized = json.dumps(payload)

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "ExternalApiCache"
                  (id, "source", "cacheKey", "payload", "createdAt", "updatedAt")
                VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, now(), now())
                ON CONFLICT ("source", "cacheKey") DO UPDATE
                SET "payload" = EXCLUDED."payload",
                    "updatedAt" = now()
                """,
                source, cache_key, serialized,
            )
    except Exception as e:
        print(f"[cache] upsert failed source={source} key={cache_key}: {e}")


async def fetch_external_cache_many(
    *, source: str, cache_keys: list[str]
) -> dict[str, Any]:
    """Batched read — returns {cache_key: payload} for keys present (no TTL)."""
    if not source or not cache_keys:
        return {}
    pool = await _get_pool()
    if pool is None:
        return {}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT "cacheKey", "payload"
                FROM "ExternalApiCache"
                WHERE "source" = $1 AND "cacheKey" = ANY($2::text[])
                """,
                source, cache_keys,
            )
    except Exception as e:
        print(f"[cache] batch lookup failed source={source}: {e}")
        return {}
    out: dict[str, Any] = {}
    for row in rows:
        raw = row["payload"]
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                continue
        out[row["cacheKey"]] = raw
    _log_cache_event("HIT", source, f"<batch {len(out)}/{len(cache_keys)}>", {})
    return out


async def upsert_external_cache_many(
    *, source: str, items: list[tuple[str, Any]]
) -> None:
    """Batched upsert of (cache_key, payload) pairs into ExternalApiCache."""
    if not source or not items:
        return
    pool = await _get_pool()
    if pool is None:
        return
    keys = [k for k, _ in items]
    payloads = [json.dumps(v) for _, v in items]
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "ExternalApiCache"
                  (id, "source", "cacheKey", "payload", "createdAt", "updatedAt")
                SELECT gen_random_uuid()::text, $1, k, p::jsonb, now(), now()
                FROM unnest($2::text[], $3::text[]) AS t(k, p)
                ON CONFLICT ("source", "cacheKey") DO UPDATE
                SET "payload" = EXCLUDED."payload", "updatedAt" = now()
                """,
                source, keys, payloads,
            )
    except Exception as e:
        print(f"[cache] batch upsert failed source={source}: {e}")
