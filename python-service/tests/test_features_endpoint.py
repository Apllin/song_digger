"""
Tests for POST /features/extract.

The endpoint is thin: it shapes payloads, calls extract_cheap_features
per candidate, and forwards rows to upsert_candidate_features_batch.
We patch the upsert function and inspect what it received instead of
hitting Postgres.
"""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _seed_payload(**overrides):
    base = {
        "search_query_id": "search-abc",
        "seed_bpm": 132.0,
        "seed_key": "8A",
        "seed_energy": 7.5,
        "seed_label": "Pole Group",
        "seed_genre": "techno",
        "candidates": [],
    }
    base.update(overrides)
    return base


def test_endpoint_persists_well_formed_request():
    candidate = {
        "trackId": "trk-1",
        "bpm": 130.0,
        "key": "8A",
        "energy": 7.0,
        "label": "Pole Group",
        "genre": "techno",
        "embedUrl": "https://example.com/embed/1",
        "nSources": 3,
        "topRank": 2,
        "rrfScore": 0.0234,
    }
    body = _seed_payload(candidates=[candidate])

    with patch(
        "app.api.routes.features.upsert_candidate_features_batch",
        new=AsyncMock(),
    ) as mock_upsert:
        resp = client.post("/features/extract", json=body)

    assert resp.status_code == 200
    assert resp.json() == {"persisted": 1}

    mock_upsert.assert_awaited_once()
    rows = mock_upsert.await_args.args[0]
    assert len(rows) == 1
    row = rows[0]
    assert row["searchQueryId"] == "search-abc"
    assert row["trackId"] == "trk-1"
    assert row["bpmDelta"] == 2.0
    assert row["keyCompat"] == 1.0
    assert row["energyDelta"] == 0.5
    assert row["labelMatch"] == 1.0
    assert row["genreMatch"] == 1.0
    assert row["nSources"] == 3
    assert row["topRank"] == 2
    assert row["hasEmbed"] == 1
    assert row["rrfScore"] == 0.0234


def test_endpoint_with_empty_candidates_still_calls_upsert():
    body = _seed_payload(candidates=[])

    with patch(
        "app.api.routes.features.upsert_candidate_features_batch",
        new=AsyncMock(),
    ) as mock_upsert:
        resp = client.post("/features/extract", json=body)

    assert resp.status_code == 200
    assert resp.json() == {"persisted": 0}
    # The upsert function gates on the empty list itself, so it's called with [].
    mock_upsert.assert_awaited_once_with([])


def test_endpoint_rejects_malformed_input():
    # Missing required candidate fields (trackId, nSources, topRank, rrfScore)
    bad_body = _seed_payload(candidates=[{"bpm": 130.0}])

    resp = client.post("/features/extract", json=bad_body)
    assert resp.status_code == 422


def test_endpoint_handles_null_seed_metadata():
    """When the seed has no inferred metadata, numeric features collapse to None
    but structural features still get persisted."""
    candidate = {
        "trackId": "trk-1",
        "bpm": 130.0,
        "key": "8A",
        "embedUrl": None,
        "nSources": 1,
        "topRank": 5,
        "rrfScore": 0.01,
    }
    body = _seed_payload(
        seed_bpm=None,
        seed_key=None,
        seed_energy=None,
        seed_label=None,
        seed_genre=None,
        candidates=[candidate],
    )

    with patch(
        "app.api.routes.features.upsert_candidate_features_batch",
        new=AsyncMock(),
    ) as mock_upsert:
        resp = client.post("/features/extract", json=body)

    assert resp.status_code == 200
    rows = mock_upsert.await_args.args[0]
    assert rows[0]["bpmDelta"] is None
    assert rows[0]["keyCompat"] is None
    assert rows[0]["nSources"] == 1
    assert rows[0]["topRank"] == 5
    assert rows[0]["hasEmbed"] == 0
