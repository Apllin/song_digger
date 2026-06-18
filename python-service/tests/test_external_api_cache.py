"""Tests for the generic ExternalApiCache helpers in app.core.db.

The helpers wrap raw asyncpg against the ExternalApiCache table; we mock the
pool/connection so tests are offline. The matrix mirrors the TS twin
(web/lib/external-api-cache.test.ts) so cache semantics stay consistent
across both sides.
"""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core import db


def _now_naive() -> datetime:
    """Naive UTC, matching the schema's TIMESTAMP(3) WITHOUT TIME ZONE."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _mock_pool(conn: MagicMock) -> MagicMock:
    """Build an asyncpg-shaped pool whose `acquire()` async-CM yields `conn`."""
    pool = MagicMock()
    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=None)
    pool.acquire = MagicMock(return_value=acquire_cm)
    return pool


@pytest.fixture(autouse=True)
def _reset_pool():
    """Reset the lazy-initialized pool between tests."""
    db._pool = None
    db._pool_init_failed = False
    yield
    db._pool = None
    db._pool_init_failed = False


# ── fetch_external_cache ─────────────────────────────────────────────────────

async def test_fetch_returns_none_on_empty_source_or_key():
    assert await db.fetch_external_cache(source="", cache_key="k") is None
    assert await db.fetch_external_cache(source="s", cache_key="") is None


async def test_fetch_returns_none_when_db_unavailable():
    with patch.object(db, "_get_pool", AsyncMock(return_value=None)):
        result = await db.fetch_external_cache(source="src", cache_key="k")
    assert result is None


async def test_fetch_miss_returns_none():
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value=None)
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        result = await db.fetch_external_cache(source="discogs_search_artist", cache_key="k")
    assert result is None


async def test_fetch_hit_no_ttl_returns_payload_regardless_of_age():
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value={
        "payload": json.dumps({"url": "https://example/cover.jpg"}),
        "updatedAt": _now_naive() - timedelta(days=365),
    })
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        result = await db.fetch_external_cache(source="itunes_cover", cache_key="k")
    assert result == {"url": "https://example/cover.jpg"}


async def test_fetch_hit_within_ttl_returns_payload():
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value={
        "payload": json.dumps([{"id": 1}]),
        "updatedAt": _now_naive() - timedelta(days=1),
    })
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        result = await db.fetch_external_cache(
            source="discogs_artist_releases",
            cache_key="k",
            ttl_seconds=30 * 86400,
        )
    assert result == [{"id": 1}]


async def test_fetch_stale_returns_none():
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value={
        "payload": json.dumps({"stale": True}),
        "updatedAt": _now_naive() - timedelta(days=31),
    })
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        result = await db.fetch_external_cache(
            source="discogs_artist_releases",
            cache_key="k",
            ttl_seconds=30 * 86400,
        )
    assert result is None


async def test_fetch_empty_array_payload_is_a_hit_not_miss():
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value={
        "payload": json.dumps([]),
        "updatedAt": _now_naive(),
    })
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        result = await db.fetch_external_cache(source="discogs_search_artist", cache_key="k")
    assert result == []


async def test_fetch_decodes_jsonb_string_payload():
    """asyncpg returns JSONB as str unless a codec is registered. We parse."""
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value={
        "payload": json.dumps({"deeply": {"nested": [1, 2, 3]}}),
        "updatedAt": _now_naive(),
    })
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        result = await db.fetch_external_cache(source="src", cache_key="k")
    assert result == {"deeply": {"nested": [1, 2, 3]}}


async def test_fetch_returns_already_decoded_payload_as_is():
    """If asyncpg has a codec installed, payload arrives as dict/list directly."""
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value={
        "payload": {"already": "decoded"},
        "updatedAt": _now_naive(),
    })
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        result = await db.fetch_external_cache(source="src", cache_key="k")
    assert result == {"already": "decoded"}


async def test_fetch_swallows_db_exception():
    conn = MagicMock()
    conn.fetchrow = AsyncMock(side_effect=Exception("connection refused"))
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        result = await db.fetch_external_cache(source="src", cache_key="k")
    assert result is None


async def test_fetch_swallows_decode_error():
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value={
        "payload": "{not valid json",
        "updatedAt": _now_naive(),
    })
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        result = await db.fetch_external_cache(source="src", cache_key="k")
    assert result is None


# ── upsert_external_cache ────────────────────────────────────────────────────

async def test_upsert_no_op_on_empty_source_or_key():
    # No call should fire — _get_pool isn't even hit.
    with patch.object(db, "_get_pool", AsyncMock(return_value=None)) as get_pool:
        await db.upsert_external_cache(source="", cache_key="k", payload={"x": 1})
        await db.upsert_external_cache(source="s", cache_key="", payload={"x": 1})
    assert get_pool.call_count == 0


async def test_upsert_no_op_when_db_unavailable():
    with patch.object(db, "_get_pool", AsyncMock(return_value=None)):
        # No exception, just returns
        await db.upsert_external_cache(source="src", cache_key="k", payload={"x": 1})


async def test_upsert_calls_insert_on_conflict_with_serialized_payload():
    conn = MagicMock()
    conn.execute = AsyncMock(return_value="INSERT 0 1")
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        await db.upsert_external_cache(
            source="itunes_cover",
            cache_key="k1",
            payload={"url": "u1"},
        )
    conn.execute.assert_awaited_once()
    args = conn.execute.await_args.args
    sql = args[0]
    assert "INSERT INTO" in sql and "ExternalApiCache" in sql
    assert "ON CONFLICT" in sql
    assert args[1] == "itunes_cover"
    assert args[2] == "k1"
    assert json.loads(args[3]) == {"url": "u1"}


async def test_upsert_persists_empty_array_as_valid_payload():
    conn = MagicMock()
    conn.execute = AsyncMock(return_value="INSERT 0 1")
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        await db.upsert_external_cache(
            source="discogs_search_artist",
            cache_key="k",
            payload=[],
        )
    args = conn.execute.await_args.args
    assert json.loads(args[3]) == []


async def test_upsert_swallows_db_exception():
    conn = MagicMock()
    conn.execute = AsyncMock(side_effect=Exception("write failed"))
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        # Must not raise — caller is best-effort.
        await db.upsert_external_cache(source="s", cache_key="k", payload={"x": 1})


# ── _get_pool soft-degradation (regression: Last.fm fallback wiped on DB outage)

async def test_get_pool_returns_none_when_database_url_empty(monkeypatch):
    monkeypatch.setattr(db.settings, "database_url", "")
    assert await db._get_pool() is None


async def test_get_pool_soft_degrades_when_connection_fails(monkeypatch, capsys):
    """create_pool() connects eagerly, so a DB outage / cold-start / SSL error
    raises at pool init — before any guarded query. It must be caught and
    soft-degraded to None, otherwise the exception propagates through every db
    helper and silently drops a whole source from the /similar fan-out."""
    monkeypatch.setattr(db.settings, "database_url", "postgres://x")
    db._pool_init_failed = False
    with patch.object(
        db.asyncpg, "create_pool", AsyncMock(side_effect=Exception("cold start"))
    ):
        assert await db._get_pool() is None
        # _pool stays None so the next request retries once the DB recovers.
        assert db._pool is None
    assert "pool init failed" in capsys.readouterr().out


async def test_get_pool_logs_once_per_outage(monkeypatch, capsys):
    """Repeated failures within an outage log a single line, not one per call."""
    monkeypatch.setattr(db.settings, "database_url", "postgres://x")
    db._pool_init_failed = False
    with patch.object(
        db.asyncpg, "create_pool", AsyncMock(side_effect=Exception("down"))
    ):
        for _ in range(5):
            assert await db._get_pool() is None
    assert capsys.readouterr().out.count("pool init failed") == 1


# ── fetch_external_cache_many ────────────────────────────────────────────────

async def test_fetch_many_returns_present_keys():
    conn = MagicMock()
    conn.fetch = AsyncMock(return_value=[
        {"cacheKey": "a", "payload": '{"x": 1}'},
        {"cacheKey": "b", "payload": {"y": 2}},
    ])
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        out = await db.fetch_external_cache_many(source="title_norm", cache_keys=["a", "b", "c"])
    assert out == {"a": {"x": 1}, "b": {"y": 2}}


async def test_fetch_many_empty_input_no_query():
    assert await db.fetch_external_cache_many(source="title_norm", cache_keys=[]) == {}


async def test_fetch_many_db_unavailable_returns_empty():
    with patch.object(db, "_get_pool", AsyncMock(return_value=None)):
        assert await db.fetch_external_cache_many(source="title_norm", cache_keys=["a"]) == {}


# ── upsert_external_cache_many ───────────────────────────────────────────────

async def test_upsert_many_empty_input_noop():
    # Must not raise and must not touch the pool
    with patch.object(db, "_get_pool", AsyncMock(return_value=None)) as get_pool:
        await db.upsert_external_cache_many(source="title_norm", items=[])
    assert get_pool.call_count == 0


async def test_upsert_many_calls_execute_once():
    conn = MagicMock()
    conn.execute = AsyncMock(return_value=None)
    pool = _mock_pool(conn)
    with patch.object(db, "_get_pool", AsyncMock(return_value=pool)):
        await db.upsert_external_cache_many(
            source="title_norm",
            items=[("k1", {"a": 1}), ("k2", {"b": 2})],
        )
    conn.execute.assert_awaited_once()
    args = conn.execute.await_args.args
    sql = args[0]
    assert "unnest" in sql
    assert "ExternalApiCache" in sql
    assert args[1] == "title_norm"
    assert args[2] == ["k1", "k2"]
    assert json.loads(args[3][0]) == {"a": 1}
    assert json.loads(args[3][1]) == {"b": 2}
