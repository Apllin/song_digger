"""Pipeline-level speed tests: full /similar fan-out + concurrent search.

Prerequisite: python-service running on http://localhost:8000.
Tests skip if the service isn't reachable.

Run with:  pytest -m speed tests/speed/test_similar_speed.py
"""
import asyncio
import time

import httpx
import pytest

from .conftest import SPEED_SEED_ARTIST, SPEED_SEED_TRACK, measure_runs, p50_p95

pytestmark = pytest.mark.speed

PYTHON_SERVICE_URL = "http://localhost:8000"

# /similar full fan-out: 6 adapters in parallel + Phase-2 fallbacks. Bandcamp
# is hard-capped at 4s, trackid at 25s, so the worst case is bounded around
# 25s. 30s threshold leaves headroom over typical warm-cache 8–15s.
SIMILAR_P95_S = 30.0

# 10 concurrent /similar requests. With async fan-out and Postgres pooling,
# wall-clock should stay close to the slowest single request, not 10x it.
# 40s allows for some pile-up under contention without hiding regressions
# (e.g. accidentally synchronous DB write in a hot path).
CONCURRENT_TOTAL_S = 40.0
CONCURRENT_N = 10

RUNS = 5


async def _service_up() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{PYTHON_SERVICE_URL}/health")
            return r.status_code == 200
    except Exception:
        return False


async def test_similar_endpoint_p95_latency():
    if not await _service_up():
        pytest.skip(f"Python service not reachable at {PYTHON_SERVICE_URL}")

    async with httpx.AsyncClient(timeout=60.0) as client:
        async def one_request():
            r = await client.post(
                f"{PYTHON_SERVICE_URL}/similar",
                json={
                    "input": f"{SPEED_SEED_ARTIST} - {SPEED_SEED_TRACK}",
                    "artist": SPEED_SEED_ARTIST,
                    "track": SPEED_SEED_TRACK,
                    "limit_per_source": 30,
                },
            )
            assert r.status_code == 200, f"non-200: {r.status_code}"
            return r

        latencies, _ = await measure_runs(one_request, runs=RUNS)

    p50, p95 = p50_p95(latencies)
    print(
        f"\n[/similar speed] P50={p50:.2f}s  P95={p95:.2f}s  "
        f"runs={[round(x, 2) for x in latencies]}"
    )
    assert p95 < SIMILAR_P95_S, f"/similar P95 {p95:.2f}s ≥ threshold {SIMILAR_P95_S}s"


# Distinct seeds so each request has to do real work — using the same
# seed 10x would let any caching layer collapse work and make the test
# meaningless as a concurrency probe.
CONCURRENT_SEEDS: list[tuple[str, str]] = [
    ("Oscar Mulero", "Horses"),
    ("Charlotte de Witte", "Apollo"),
    ("Nina Kraviz", "Tarde"),
    ("Plastikman", "Spastik"),
    ("Surgeon", "Klonk"),
    ("Amelie Lens", "Hypnotized"),
    ("Adam Beyer", "Your Mind"),
    ("Ben Sims", "Manipulated"),
    ("Joey Beltram", "Energy Flash"),
    ("Robert Hood", "Minus"),
]


async def test_concurrent_similar_requests():
    if not await _service_up():
        pytest.skip(f"Python service not reachable at {PYTHON_SERVICE_URL}")
    assert len(CONCURRENT_SEEDS) == CONCURRENT_N

    async with httpx.AsyncClient(timeout=90.0) as client:
        start = time.monotonic()
        responses = await asyncio.gather(
            *[
                client.post(
                    f"{PYTHON_SERVICE_URL}/similar",
                    json={
                        "input": f"{a} - {t}",
                        "artist": a,
                        "track": t,
                        "limit_per_source": 30,
                    },
                )
                for a, t in CONCURRENT_SEEDS
            ],
            return_exceptions=True,
        )
        elapsed = time.monotonic() - start

    errors = [r for r in responses if isinstance(r, Exception)]
    non_200 = [
        r for r in responses
        if not isinstance(r, Exception) and r.status_code != 200
    ]
    print(
        f"\n[concurrent speed] {CONCURRENT_N} requests in {elapsed:.2f}s, "
        f"errors={len(errors)}, non-200={len(non_200)}"
    )
    assert not errors, f"{len(errors)} requests raised: {errors[:3]}"
    assert not non_200, (
        f"{len(non_200)} requests non-200: "
        f"{[(r.status_code, r.text[:100]) for r in non_200[:3]]}"
    )
    assert elapsed < CONCURRENT_TOTAL_S, (
        f"{CONCURRENT_N} concurrent /similar took {elapsed:.2f}s ≥ "
        f"threshold {CONCURRENT_TOTAL_S}s"
    )
