"""Tests for the background Discogs cache warmer (app.services.discogs_warm)."""
import asyncio
from unittest.mock import AsyncMock

from app.services import discogs_warm


class _StubAdapter:
    def __init__(self) -> None:
        self.built: list[str] = []

    async def build_collaborative(self, query: str, limit: int):
        self.built.append(query)
        return []

    async def aclose(self) -> None:
        pass


async def test_request_warm_noop_when_not_started():
    await discogs_warm.stop()  # ensure clean global state
    discogs_warm.request_warm("Joe Milli - Retreat")
    assert "Joe Milli - Retreat" not in discogs_warm._inflight


async def test_worker_builds_on_cache_miss(monkeypatch):
    monkeypatch.setattr(discogs_warm, "_MIN_INTERVAL_S", 0.0)
    monkeypatch.setattr("app.core.db.fetch_external_cache", AsyncMock(return_value=None))
    adapter = _StubAdapter()
    discogs_warm.start(adapter)
    try:
        discogs_warm.request_warm("Joe Milli - Retreat")
        await asyncio.wait_for(discogs_warm._queue.join(), timeout=2)
        assert adapter.built == ["Joe Milli - Retreat"]
    finally:
        await discogs_warm.stop()


async def test_worker_skips_fresh_entry(monkeypatch):
    # A fresh (non-None) cache read means another path already warmed it → skip.
    monkeypatch.setattr(discogs_warm, "_MIN_INTERVAL_S", 0.0)
    monkeypatch.setattr("app.core.db.fetch_external_cache", AsyncMock(return_value=[]))
    adapter = _StubAdapter()
    discogs_warm.start(adapter)
    try:
        discogs_warm.request_warm("Joe Milli - Retreat")
        await asyncio.wait_for(discogs_warm._queue.join(), timeout=2)
        assert adapter.built == []
    finally:
        await discogs_warm.stop()


async def test_request_warm_dedups_inflight(monkeypatch):
    monkeypatch.setattr(discogs_warm, "_MIN_INTERVAL_S", 0.0)
    monkeypatch.setattr("app.core.db.fetch_external_cache", AsyncMock(return_value=None))
    started = asyncio.Event()
    release = asyncio.Event()

    class _Blocking(_StubAdapter):
        async def build_collaborative(self, query: str, limit: int):
            self.built.append(query)
            started.set()
            await release.wait()
            return []

    adapter = _Blocking()
    discogs_warm.start(adapter)
    try:
        discogs_warm.request_warm("X - Y")
        await asyncio.wait_for(started.wait(), timeout=2)  # worker is mid-build
        discogs_warm.request_warm("X - Y")                 # duplicate while inflight
        assert discogs_warm._queue.qsize() == 0            # not re-queued
        release.set()
        await asyncio.wait_for(discogs_warm._queue.join(), timeout=2)
        assert adapter.built == ["X - Y"]
    finally:
        release.set()
        await discogs_warm.stop()
