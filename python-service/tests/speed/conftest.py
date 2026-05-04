"""Shared helpers for the speed-test suite.

Use plain `time.monotonic()` for measurement; pytest-benchmark would be
overkill — we just want a P95 over 5 runs to catch regressions like
"this adapter became 3x slower". Speed tests must NOT run in parallel
(pytest-xdist or similar) since concurrent network use makes per-call
timing meaningless.
"""
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

T = TypeVar("T")


async def measure_runs(
    fn: Callable[[], Awaitable[T]],
    runs: int = 5,
) -> tuple[list[float], list[T]]:
    """Run `fn` `runs` times sequentially. Return (latencies, results)."""
    latencies: list[float] = []
    results: list[T] = []
    for _ in range(runs):
        start = time.monotonic()
        result = await fn()
        latencies.append(time.monotonic() - start)
        results.append(result)
    return latencies, results


def p50_p95(latencies: list[float]) -> tuple[float, float]:
    """For 5 runs we approximate P95 ≈ max, P50 ≈ median. Not statistically
    rigorous but sufficient for threshold gating."""
    if not latencies:
        return 0.0, 0.0
    s = sorted(latencies)
    p50 = s[len(s) // 2]
    p95 = s[-1]
    return p50, p95


# Common fan-out seed for speed measurement. One seed is enough — we're
# measuring latency, not coverage.
SPEED_SEED_ARTIST = "Oscar Mulero"
SPEED_SEED_TRACK = "Horses"
SPEED_SEED_QUERY = f"{SPEED_SEED_ARTIST} - {SPEED_SEED_TRACK}"
