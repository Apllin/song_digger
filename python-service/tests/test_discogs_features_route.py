"""
Tests for POST /features/discogs-fill (Stage C2 background fill).

The handler talks to three things:
  1. The Discogs adapter (search + per-release credit fetches)
  2. The ArtistDiscography / ArtistCollaborations caches in Postgres
  3. The CandidateFeatures table (UPDATE for the C2 columns)

Tests patch the cache helpers and adapter methods directly on the
discogs_features route module so they don't touch real I/O.
"""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _patch(target: str, **kwargs):
    """Shorthand for patching a name on app.api.routes.discogs_features."""
    return patch(f"app.api.routes.discogs_features.{target}", **kwargs)


def _candidate(track_id: str, artist: str, title: str = "Some Track") -> dict:
    return {"trackId": track_id, "artist": artist, "title": title}


def _payload(**overrides) -> dict:
    base = {
        "search_query_id": "search-abc",
        "seed_artist": "Oscar Mulero",
        "candidates": [_candidate("t1", "Ancient Methods")],
    }
    base.update(overrides)
    return base


def test_endpoint_skips_when_seed_artist_missing():
    """No seed → no Discogs work, no UPDATE."""
    body = _payload(seed_artist="")

    with _patch("_discogs") as mock_discogs, \
         _patch("update_candidate_features_discogs_batch", new=AsyncMock()) as mock_update:
        resp = client.post("/features/discogs-fill", json=body)

    assert resp.status_code == 200
    assert resp.json()["updated"] == 0
    mock_discogs.fetch_artist_discography.assert_not_called()
    mock_update.assert_not_called()


def test_endpoint_skips_when_no_candidates():
    body = _payload(candidates=[])
    with _patch("_discogs") as mock_discogs, \
         _patch("update_candidate_features_discogs_batch", new=AsyncMock()) as mock_update:
        resp = client.post("/features/discogs-fill", json=body)

    assert resp.status_code == 200
    assert resp.json()["updated"] == 0
    mock_discogs.fetch_artist_discography.assert_not_called()
    mock_update.assert_not_called()


def test_cache_hit_skips_discogs_api_for_seed():
    """When the seed's discography is cached, no API call is made for it."""
    body = _payload(candidates=[_candidate("t1", "Regis")])

    seed_disc = [
        {"releaseId": "r1", "year": 2018, "title": "x", "label": "PoleGroup"},
        {"releaseId": "r2", "year": 2020, "title": "y", "label": "Token"},
    ]
    cand_disc = [
        {"releaseId": "r9", "year": 2019, "title": "z", "label": "Downwards"},
    ]

    cache_calls: list[str] = []

    async def fake_disc_cache(*, artist, ttl_days):
        cache_calls.append(artist)
        return {"oscarmulero": seed_disc, "regis": cand_disc}.get(artist)

    async def fake_collab_cache(*, artist, ttl_days):
        return {"oscarmulero": {"regis"}}.get(artist)

    with _patch("fetch_artist_discography_cache", new=AsyncMock(side_effect=fake_disc_cache)), \
         _patch("fetch_artist_collaborations_cache", new=AsyncMock(side_effect=fake_collab_cache)), \
         _patch("upsert_artist_discography", new=AsyncMock()), \
         _patch("upsert_artist_collaborations", new=AsyncMock()), \
         _patch("update_candidate_features_discogs_batch",
                new=AsyncMock(return_value=1)) as mock_update, \
         _patch("_discogs") as mock_discogs:
        resp = client.post("/features/discogs-fill", json=body)

    assert resp.status_code == 200
    # No Discogs API calls — both seed and candidate served from cache.
    mock_discogs.fetch_artist_discography.assert_not_called()
    mock_discogs.fetch_release_credits.assert_not_called()

    # UPDATE should have run with one row computed from the cached data.
    mock_update.assert_awaited_once()
    kwargs = mock_update.await_args.kwargs
    assert kwargs["search_query_id"] == "search-abc"
    [u] = kwargs["updates"]
    assert u["trackId"] == "t1"
    assert u["yearProximity"] == 0.5  # 2020 vs 2019 → 1/2
    assert u["artistCorelease"] == 1   # "regis" in seed_collabs


def test_cache_miss_falls_back_to_api_and_persists():
    """Seed has no cache → adapter is hit, results are written to cache."""
    body = _payload(candidates=[_candidate("t1", "Regis")])

    seed_disc = [
        {"releaseId": "r1", "year": 2018, "title": "x", "label": "PoleGroup"},
    ]
    cand_disc = [
        {"releaseId": "r9", "year": 2019, "title": "z", "label": "Downwards"},
    ]

    async def empty_disc_cache(**kwargs):
        return None

    async def empty_collab_cache(**kwargs):
        return None

    async def fake_fetch_discography(name):
        return {"oscarmulero": seed_disc, "regis": cand_disc}[name]

    async def fake_fetch_credits(release_id):
        # Seed's r1 has Ancient Methods on it.
        return {"r1": ["Oscar Mulero", "Ancient Methods"]}.get(release_id, [])

    mock_discogs = AsyncMock()
    mock_discogs.fetch_artist_discography = AsyncMock(side_effect=fake_fetch_discography)
    mock_discogs.fetch_release_credits = AsyncMock(side_effect=fake_fetch_credits)

    with _patch("fetch_artist_discography_cache", new=AsyncMock(side_effect=empty_disc_cache)), \
         _patch("fetch_artist_collaborations_cache", new=AsyncMock(side_effect=empty_collab_cache)), \
         _patch("upsert_artist_discography", new=AsyncMock()) as mock_disc_upsert, \
         _patch("upsert_artist_collaborations", new=AsyncMock()) as mock_collab_upsert, \
         _patch("_discogs", new=mock_discogs), \
         _patch("update_candidate_features_discogs_batch", new=AsyncMock(return_value=1)) as mock_update:
        resp = client.post("/features/discogs-fill", json=body)

    assert resp.status_code == 200
    # API hit for both artists' discographies, plus credits for the seed's
    # one release.
    assert mock_discogs.fetch_artist_discography.await_count == 2
    mock_discogs.fetch_release_credits.assert_awaited_once_with("r1")

    # Cache writes happened for both kinds (seed disc, seed collabs, cand disc).
    assert mock_disc_upsert.await_count == 2
    mock_collab_upsert.assert_awaited_once()

    [u] = mock_update.await_args.kwargs["updates"]
    assert u["yearProximity"] == 0.5  # 2018 vs 2019
    # "Regis" is not in seed collabs ({"ancientmethods"} only) → 0
    assert u["artistCorelease"] == 0


def test_unknown_seed_yields_null_features():
    """Discogs returns None for the seed → both C2 features are None."""
    body = _payload(candidates=[_candidate("t1", "Regis")])

    async def empty_cache(**kwargs):
        return None

    mock_discogs = AsyncMock()
    mock_discogs.fetch_artist_discography = AsyncMock(return_value=None)

    with _patch("fetch_artist_discography_cache", new=AsyncMock(side_effect=empty_cache)), \
         _patch("fetch_artist_collaborations_cache", new=AsyncMock(side_effect=empty_cache)), \
         _patch("upsert_artist_discography", new=AsyncMock()), \
         _patch("upsert_artist_collaborations", new=AsyncMock()), \
         _patch("_discogs", new=mock_discogs), \
         _patch("update_candidate_features_discogs_batch", new=AsyncMock(return_value=1)) as mock_update:
        resp = client.post("/features/discogs-fill", json=body)

    assert resp.status_code == 200
    [u] = mock_update.await_args.kwargs["updates"]
    assert u["yearProximity"] is None
    assert u["artistCorelease"] is None


def test_mixed_known_and_unknown_candidates():
    """Some candidates resolved, others not — nulls preserved per-row."""
    body = _payload(candidates=[
        _candidate("t-known", "Regis"),
        _candidate("t-unknown", "Nobody Anywhere"),
    ])

    seed_disc = [{"releaseId": "r1", "year": 2020, "title": "x", "label": "L"}]
    regis_disc = [{"releaseId": "r2", "year": 2019, "title": "y", "label": "L"}]

    async def disc_cache(*, artist, ttl_days):
        return {
            "oscarmulero": seed_disc,
            "regis": regis_disc,
            # "nobodyanywhere" has no entry — cache miss
        }.get(artist)

    async def collab_cache(*, artist, ttl_days):
        return {"oscarmulero": {"regis"}}.get(artist)

    mock_discogs = AsyncMock()
    mock_discogs.fetch_artist_discography = AsyncMock(return_value=None)

    with _patch("fetch_artist_discography_cache", new=AsyncMock(side_effect=disc_cache)), \
         _patch("fetch_artist_collaborations_cache", new=AsyncMock(side_effect=collab_cache)), \
         _patch("upsert_artist_discography", new=AsyncMock()), \
         _patch("upsert_artist_collaborations", new=AsyncMock()), \
         _patch("_discogs", new=mock_discogs), \
         _patch("update_candidate_features_discogs_batch", new=AsyncMock(return_value=2)) as mock_update:
        resp = client.post("/features/discogs-fill", json=body)

    assert resp.status_code == 200
    updates = mock_update.await_args.kwargs["updates"]
    by_id = {u["trackId"]: u for u in updates}

    assert by_id["t-known"]["yearProximity"] == 0.5
    assert by_id["t-known"]["artistCorelease"] == 1

    # Unknown artist → discography None → year None, but seed_collabs is
    # known so corelease is 0 (we know they're not collaborators).
    assert by_id["t-unknown"]["yearProximity"] is None
    assert by_id["t-unknown"]["artistCorelease"] == 0


def test_update_targets_search_query_and_track_id():
    body = _payload(candidates=[_candidate("trk-1", "Regis")])

    async def disc_cache(*, artist, ttl_days):
        return {
            "oscarmulero": [{"releaseId": "r1", "year": 2020, "title": "x", "label": "L"}],
            "regis": [{"releaseId": "r2", "year": 2019, "title": "y", "label": "L"}],
        }.get(artist)

    async def collab_cache(*, artist, ttl_days):
        return {"oscarmulero": set()}.get(artist)

    with _patch("fetch_artist_discography_cache", new=AsyncMock(side_effect=disc_cache)), \
         _patch("fetch_artist_collaborations_cache", new=AsyncMock(side_effect=collab_cache)), \
         _patch("upsert_artist_discography", new=AsyncMock()), \
         _patch("upsert_artist_collaborations", new=AsyncMock()), \
         _patch("_discogs"), \
         _patch("update_candidate_features_discogs_batch",
                new=AsyncMock(return_value=1)) as mock_update:
        resp = client.post("/features/discogs-fill", json=body)

    assert resp.status_code == 200
    kwargs = mock_update.await_args.kwargs
    assert kwargs["search_query_id"] == "search-abc"
    [u] = kwargs["updates"]
    assert u["trackId"] == "trk-1"


def test_zero_matched_rows_logs_but_succeeds(capsys):
    """Race with /features/extract: rows don't exist yet, log and succeed."""
    body = _payload(candidates=[_candidate("t1", "Regis")])

    async def disc_cache(*, artist, ttl_days):
        return {
            "oscarmulero": [{"releaseId": "r1", "year": 2020, "title": "x", "label": "L"}],
            "regis": [{"releaseId": "r2", "year": 2019, "title": "y", "label": "L"}],
        }.get(artist)

    async def collab_cache(*, artist, ttl_days):
        return {"oscarmulero": set()}.get(artist)

    with _patch("fetch_artist_discography_cache", new=AsyncMock(side_effect=disc_cache)), \
         _patch("fetch_artist_collaborations_cache", new=AsyncMock(side_effect=collab_cache)), \
         _patch("upsert_artist_discography", new=AsyncMock()), \
         _patch("upsert_artist_collaborations", new=AsyncMock()), \
         _patch("_discogs"), \
         _patch("update_candidate_features_discogs_batch",
                new=AsyncMock(return_value=0)):
        resp = client.post("/features/discogs-fill", json=body)

    assert resp.status_code == 200
    assert resp.json()["updated"] == 0
    captured = capsys.readouterr().out
    assert "matched 0 rows" in captured
