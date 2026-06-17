"""Background warmer for the Discogs collaborative cache.

The /similar hot path only READS the `discogs_similar` cache; this fills it,
automatically, following real search traffic. When a search misses (a cold or
expired seed), `find_similar` calls `request_warm()`, which enqueues the seed
for a single background worker. The worker rebuilds the cache via
`DiscogsAdapter.build_collaborative` — throttled under the Discogs rate limit,
deduped, and skipping seeds another path already refreshed.

Zero manual steps: no cron, no scripts, no seed lists. No-op until the worker is
started (app lifespan) and `DISCOGS_STATS_UNBLOCKER_URL` is configured.
"""
import asyncio

_MIN_INTERVAL_S = 12.0          # ≤5 builds/min — comfortably under Discogs' 60 req/min
_REFRESH_TTL_S = 25 * 86400     # rebuild when the cached entry is older than this
_MAX_QUEUE = 500

_queue: asyncio.Queue[str] | None = None
_inflight: set[str] = set()
_worker: asyncio.Task | None = None
_adapter = None


def request_warm(query: str) -> None:
    """Fire-and-forget enqueue of a seed for background warming. Safe to call on
    every search: no-ops when the worker isn't running, the seed is already
    queued, or the queue is full."""
    if _queue is None or query in _inflight:
        return
    _inflight.add(query)
    try:
        _queue.put_nowait(query)
    except asyncio.QueueFull:
        _inflight.discard(query)


async def _run(adapter) -> None:
    from app.adapters.discogs import _COLLAB_OUTPUT_LIMIT, _normalize_query
    from app.core.db import fetch_external_cache

    assert _queue is not None
    while True:
        query = await _queue.get()
        try:
            # Another search/instance may have warmed it since enqueue — skip if fresh.
            fresh = await fetch_external_cache(
                source="discogs_similar",
                cache_key=_normalize_query(query),
                ttl_seconds=_REFRESH_TTL_S,
            )
            if fresh is None:
                await adapter.build_collaborative(query, _COLLAB_OUTPUT_LIMIT)
                await asyncio.sleep(_MIN_INTERVAL_S)   # throttle the Discogs API
        except Exception as e:
            print(f"[DiscogsWarm] warm failed q={query!r}: {e}")
        finally:
            _inflight.discard(query)
            _queue.task_done()


def start(adapter=None) -> None:
    """Start the background warm worker (idempotent). Owns its own adapter unless
    one is injected (tests)."""
    global _queue, _worker, _adapter
    if _worker is not None:
        return
    if adapter is None:
        from app.adapters.discogs import DiscogsAdapter
        adapter = DiscogsAdapter()
    _adapter = adapter
    _queue = asyncio.Queue(maxsize=_MAX_QUEUE)
    _worker = asyncio.create_task(_run(adapter))


async def stop() -> None:
    """Cancel the worker and close the owned adapter (app shutdown)."""
    global _worker, _queue, _adapter
    if _worker is not None:
        _worker.cancel()
        try:
            await _worker
        except asyncio.CancelledError:
            pass
    if _adapter is not None and hasattr(_adapter, "aclose"):
        await _adapter.aclose()
    _worker = None
    _queue = None
    _adapter = None
    _inflight.clear()
