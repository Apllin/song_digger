"""Smoke test for the Python /similar endpoint (full fan-out).

Hits the live Python service at http://localhost:8000. Skips with a
clear message if the service isn't up — start it with `pnpm dev` or
`cd python-service && .venv/bin/uvicorn app.main:app --reload`.

Run with:  pytest -m smoke tests/smoke/test_similar_smoke.py
"""
import httpx
import pytest

PYTHON_SERVICE_URL = "http://localhost:8000"
PYTHON_TIMEOUT = 60.0  # generous; cold-cache fan-out can be ~30s

pytestmark = pytest.mark.smoke


async def _service_up() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{PYTHON_SERVICE_URL}/health")
            return r.status_code == 200
    except Exception:
        return False


async def test_similar_endpoint_returns_useful_response():
    if not await _service_up():
        pytest.skip(
            f"Python service not reachable at {PYTHON_SERVICE_URL}. "
            "Start it with `pnpm dev` or uvicorn."
        )

    async with httpx.AsyncClient(timeout=PYTHON_TIMEOUT) as client:
        resp = await client.post(
            f"{PYTHON_SERVICE_URL}/similar",
            json={
                "input": "Oscar Mulero - Horses",
                "artist": "Oscar Mulero",
                "track": "Horses",
                "limit_per_source": 30,
            },
        )

    assert resp.status_code == 200, f"non-200: {resp.status_code} {resp.text[:300]}"

    body = resp.json()
    assert "source_lists" in body
    assert isinstance(body["source_lists"], list)

    contributing_sources = [
        sl["source"] for sl in body["source_lists"] if sl["tracks"]
    ]
    print(f"\n[/similar smoke] contributing sources: {contributing_sources}")

    # ≥3 of 6 sources should contribute on a popular seed. If only 1-2
    # contribute, something is broken even if the response shape is fine.
    assert len(contributing_sources) >= 3, (
        f"only {len(contributing_sources)} sources contributed: "
        f"{contributing_sources}"
    )

    # ≥10 unique candidates after fan-out across all sources combined.
    unique_urls = {
        t["sourceUrl"] for sl in body["source_lists"] for t in sl["tracks"]
    }
    print(f"[/similar smoke] unique candidates: {len(unique_urls)}")
    assert len(unique_urls) >= 10, f"only {len(unique_urls)} unique candidates"


async def test_similar_artist_only_mode():
    """Artist-only queries (track=None) should still return results from
    Cosine + YTM artist + Yandex per the artist-only code path in
    _find_by_artist_only."""
    if not await _service_up():
        pytest.skip("Python service not reachable")

    async with httpx.AsyncClient(timeout=PYTHON_TIMEOUT) as client:
        resp = await client.post(
            f"{PYTHON_SERVICE_URL}/similar",
            json={
                "input": "Oscar Mulero",
                "artist": "Oscar Mulero",
                "track": None,
                "limit_per_source": 30,
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    contributing = [sl["source"] for sl in body["source_lists"] if sl["tracks"]]
    print(f"\n[/similar artist-only smoke] sources: {contributing}")
    assert len(contributing) >= 1, "artist-only mode returned no results from any source"
