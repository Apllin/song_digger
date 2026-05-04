"""Tests for Last.fm adapter: track.getSimilar parsing and graceful failures,
and the artist-level fallback used when track-level returns 0 results."""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.adapters.lastfm import (
    LASTFM_FALLBACK_TOTAL_CAP,
    LastfmAdapter,
    _split_query,
)


# ── _split_query ──────────────────────────────────────────────────────────────

def test_split_query_artist_track():
    assert _split_query("Oscar Mulero - Horses") == ("Oscar Mulero", "Horses")


def test_split_query_artist_only():
    assert _split_query("Oscar Mulero") == ("Oscar Mulero", None)


def test_split_query_trailing_separator():
    # "Artist - " (no track after dash) should be treated as artist-only.
    assert _split_query("Oscar Mulero - ") == ("Oscar Mulero", None)


def test_split_query_extra_separators_keep_first_split():
    # Track titles can contain " - " (e.g. remix dashes); first split wins.
    assert _split_query("Oscar Mulero - Horses - Remix") == (
        "Oscar Mulero",
        "Horses - Remix",
    )


# ── helpers ───────────────────────────────────────────────────────────────────

def _ok_response(payload: dict) -> MagicMock:
    """Build a mock httpx Response — raise_for_status is a no-op, json() returns payload."""
    resp = MagicMock(spec=httpx.Response)
    resp.raise_for_status = MagicMock(return_value=None)
    resp.json = MagicMock(return_value=payload)
    return resp


def _patch_client(get_return):
    """Patch httpx.AsyncClient so .get(...) returns get_return; returns the patcher's start handle."""
    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=get_return)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return patch("app.adapters.lastfm.httpx.AsyncClient", return_value=mock_client)


def _patch_method_router(routes: dict, error_for: set[str] | None = None):
    """
    Patch httpx.AsyncClient so .get dispatches by params["method"].

    `routes` maps method name -> JSON payload. `error_for` is a set of method
    names that should raise an httpx error instead of returning a payload.
    Records calls on the returned mock_client.get for assertions.
    """
    error_for = error_for or set()
    mock_client = MagicMock()

    async def _get(_url, params=None, **_kwargs):
        method = (params or {}).get("method", "")
        if method in error_for:
            raise httpx.ConnectError(f"boom {method}")
        payload = routes.get(method, {})
        return _ok_response(payload)

    mock_client.get = AsyncMock(side_effect=_get)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client, patch(
        "app.adapters.lastfm.httpx.AsyncClient", return_value=mock_client
    )


# ── LastfmAdapter.find_similar (track-level path) ─────────────────────────────

SIMILAR_RESPONSE = {
    "similartracks": {
        "track": [
            {
                "name": "Glance",
                "match": "0.8421",
                "url": "https://www.last.fm/music/Oscar+Mulero/_/Glance",
                "artist": {"name": "Oscar Mulero"},
                "image": [
                    {"#text": "https://lastfm.freetls.fastly.net/i/u/34s/a.png", "size": "small"},
                    {"#text": "https://lastfm.freetls.fastly.net/i/u/300x300/a.png", "size": "extralarge"},
                ],
            },
            {
                "name": "Decay",
                "match": "0.6312",
                "url": "https://www.last.fm/music/Rene+Wise/_/Decay",
                "artist": {"name": "Rene Wise"},
                "image": [],
            },
            {
                "name": "Static",
                "match": "0.2710",
                "url": "https://www.last.fm/music/Linear+System/_/Static",
                "artist": {"name": "Linear System"},
                "image": [],
            },
        ]
    }
}


async def test_find_similar_happy_path():
    adapter = LastfmAdapter()
    with patch("app.adapters.lastfm.settings") as mock_settings, _patch_client(_ok_response(SIMILAR_RESPONSE)):
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = False
        results = await adapter.find_similar("Oscar Mulero - Horses")

    assert len(results) == 3
    first = results[0]
    assert first.title == "Glance"
    assert first.artist == "Oscar Mulero"
    assert first.source == "lastfm"
    assert first.sourceUrl == "https://www.last.fm/music/Oscar+Mulero/_/Glance"
    assert first.coverUrl == "https://lastfm.freetls.fastly.net/i/u/300x300/a.png"
    assert first.score == pytest.approx(0.8421)
    # Tracks without an extralarge image have coverUrl = None
    assert results[1].coverUrl is None


async def test_find_similar_no_api_key_returns_empty():
    adapter = LastfmAdapter()
    mock_client = MagicMock()
    mock_client.get = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters.lastfm.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = ""
        mock_settings.lastfm_artist_fallback_enabled = True  # flag has no effect without key
        results = await adapter.find_similar("Oscar Mulero - Horses")

    assert results == []
    mock_client.get.assert_not_called()


async def test_find_similar_artist_only_returns_empty():
    adapter = LastfmAdapter()
    mock_client = MagicMock()
    mock_client.get = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters.lastfm.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = True
        results = await adapter.find_similar("Oscar Mulero")

    assert results == []
    mock_client.get.assert_not_called()


async def test_find_similar_filters_below_match_floor():
    payload = {
        "similartracks": {
            "track": [
                {
                    "name": "Above Floor",
                    "match": "0.5",
                    "url": "https://www.last.fm/music/A/_/Above",
                    "artist": {"name": "A"},
                    "image": [],
                },
                {
                    "name": "Below Floor",
                    "match": "0.01",
                    "url": "https://www.last.fm/music/B/_/Below",
                    "artist": {"name": "B"},
                    "image": [],
                },
            ]
        }
    }
    adapter = LastfmAdapter()
    with patch("app.adapters.lastfm.settings") as mock_settings, _patch_client(_ok_response(payload)):
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = False
        results = await adapter.find_similar("X - Y")

    assert len(results) == 1
    assert results[0].title == "Above Floor"


async def test_find_similar_swallows_network_errors():
    adapter = LastfmAdapter()
    mock_client = MagicMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("boom"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters.lastfm.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = False
        results = await adapter.find_similar("X - Y")

    assert results == []


# ── Artist-level fallback ─────────────────────────────────────────────────────

EMPTY_TRACK_SIMILAR = {"similartracks": {"track": []}}


def _artist_similar_payload(entries: list[tuple[str, float]]) -> dict:
    return {
        "similarartists": {
            "artist": [
                {
                    "name": name,
                    "match": str(match),
                    "url": f"https://www.last.fm/music/{name.replace(' ', '+')}",
                }
                for name, match in entries
            ]
        }
    }


def _top_tracks_payload(artist: str, titles: list[str]) -> dict:
    return {
        "toptracks": {
            "track": [
                {
                    "name": title,
                    "artist": {"name": artist},
                    "url": f"https://www.last.fm/music/{artist.replace(' ', '+')}/_/{title.replace(' ', '+')}",
                }
                for title in titles
            ]
        }
    }


async def test_fallback_not_triggered_when_track_level_returns_results():
    """Even with the flag on, a non-empty track.getSimilar short-circuits before
    artist.getSimilar is ever called."""
    adapter = LastfmAdapter()
    mock_client, client_patch = _patch_method_router({
        "track.getsimilar": SIMILAR_RESPONSE,
        # If we did fall through, this would dominate; assertion below checks we don't
        "artist.getsimilar": _artist_similar_payload([("X", 0.9)]),
    })
    with patch("app.adapters.lastfm.settings") as mock_settings, client_patch:
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = True
        results = await adapter.find_similar("Oscar Mulero - Horses")

    assert len(results) == 3
    assert results[0].title == "Glance"
    methods_called = [c.kwargs["params"]["method"] for c in mock_client.get.call_args_list]
    assert methods_called == ["track.getsimilar"]


async def test_fallback_disabled_returns_empty_when_track_level_empty():
    """Current behavior preserved: flag off + empty track-level → []."""
    adapter = LastfmAdapter()
    mock_client, client_patch = _patch_method_router({
        "track.getsimilar": EMPTY_TRACK_SIMILAR,
    })
    with patch("app.adapters.lastfm.settings") as mock_settings, client_patch:
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = False
        results = await adapter.find_similar("Underground - Track")

    assert results == []
    methods_called = [c.kwargs["params"]["method"] for c in mock_client.get.call_args_list]
    assert methods_called == ["track.getsimilar"]


async def test_fallback_cache_miss_calls_api_and_writes_cache():
    adapter = LastfmAdapter()
    artist_payload = _artist_similar_payload([("Reeko", 0.95), ("Exium", 0.80)])
    mock_client, client_patch = _patch_method_router({
        "track.getsimilar": EMPTY_TRACK_SIMILAR,
        "artist.getsimilar": artist_payload,
        "artist.gettoptracks": _top_tracks_payload("Reeko", ["A", "B", "C"]),
    })
    fetch_mock = AsyncMock(return_value=None)  # cache miss
    upsert_mock = AsyncMock()
    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters.lastfm.fetch_lastfm_artist_similars", fetch_mock), \
         patch("app.adapters.lastfm.upsert_lastfm_artist_similars", upsert_mock), \
         client_patch:
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = True
        results = await adapter.find_similar("Underground - Track")

    assert results, "fallback should have produced tracks"
    fetch_mock.assert_awaited_once()
    upsert_mock.assert_awaited_once()
    similars_written = upsert_mock.await_args.kwargs["similars"]
    assert [s["name"] for s in similars_written] == ["Reeko", "Exium"]
    methods_called = [c.kwargs["params"]["method"] for c in mock_client.get.call_args_list]
    assert "artist.getsimilar" in methods_called


async def test_fallback_cache_hit_skips_artist_getsimilar_api_call():
    adapter = LastfmAdapter()
    cached_similars = [
        {"name": "Reeko", "match": 0.9, "url": "u1"},
        {"name": "Exium", "match": 0.8, "url": "u2"},
    ]
    mock_client, client_patch = _patch_method_router({
        "track.getsimilar": EMPTY_TRACK_SIMILAR,
        # If artist.getsimilar were called, this would be the response.
        "artist.getsimilar": _artist_similar_payload([("WRONG", 0.99)]),
        "artist.gettoptracks": _top_tracks_payload("Reeko", ["A"]),
    })
    fetch_mock = AsyncMock(return_value=cached_similars)
    upsert_mock = AsyncMock()
    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters.lastfm.fetch_lastfm_artist_similars", fetch_mock), \
         patch("app.adapters.lastfm.upsert_lastfm_artist_similars", upsert_mock), \
         client_patch:
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = True
        results = await adapter.find_similar("Underground - Track")

    assert results
    assert results[0].artist == "Reeko"
    fetch_mock.assert_awaited_once()
    upsert_mock.assert_not_awaited()
    methods_called = [c.kwargs["params"]["method"] for c in mock_client.get.call_args_list]
    assert "artist.getsimilar" not in methods_called


async def test_fallback_artist_getsimilar_error_returns_empty():
    """When artist.getSimilar errors out, the cache write still happens (with
    [] so we don't hammer the API), and the adapter returns []."""
    adapter = LastfmAdapter()
    mock_client, client_patch = _patch_method_router(
        {"track.getsimilar": EMPTY_TRACK_SIMILAR},
        error_for={"artist.getsimilar"},
    )
    fetch_mock = AsyncMock(return_value=None)
    upsert_mock = AsyncMock()
    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters.lastfm.fetch_lastfm_artist_similars", fetch_mock), \
         patch("app.adapters.lastfm.upsert_lastfm_artist_similars", upsert_mock), \
         client_patch:
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = True
        results = await adapter.find_similar("Underground - Track")

    assert results == []
    upsert_mock.assert_awaited_once()
    assert upsert_mock.await_args.kwargs["similars"] == []


async def test_fallback_partial_top_tracks_failure_aggregates_rest():
    """If one similar artist's getTopTracks errors, other artists' tracks still
    contribute to the aggregate."""
    adapter = LastfmAdapter()
    artist_payload = _artist_similar_payload([("Reeko", 0.9), ("BROKEN", 0.85)])

    # Build a router that succeeds for Reeko's top tracks but errors for BROKEN.
    mock_client = MagicMock()

    async def _get(_url, params=None, **_kwargs):
        method = (params or {}).get("method", "")
        artist = (params or {}).get("artist", "")
        if method == "track.getsimilar":
            return _ok_response(EMPTY_TRACK_SIMILAR)
        if method == "artist.getsimilar":
            return _ok_response(artist_payload)
        if method == "artist.gettoptracks":
            if artist == "BROKEN":
                raise httpx.ConnectError("boom")
            return _ok_response(_top_tracks_payload("Reeko", ["A", "B"]))
        return _ok_response({})

    mock_client.get = AsyncMock(side_effect=_get)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters.lastfm.fetch_lastfm_artist_similars", AsyncMock(return_value=None)), \
         patch("app.adapters.lastfm.upsert_lastfm_artist_similars", AsyncMock()), \
         patch("app.adapters.lastfm.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = True
        results = await adapter.find_similar("Underground - Track")

    assert len(results) == 2
    assert all(r.artist == "Reeko" for r in results)


async def test_fallback_caps_total_contribution():
    """20 similar artists × 5 tracks each = 100 candidates; output must not
    exceed LASTFM_FALLBACK_TOTAL_CAP (30)."""
    adapter = LastfmAdapter()
    cached_similars = [
        {"name": f"Artist{i}", "match": 0.9 - i * 0.01, "url": f"u{i}"}
        for i in range(20)
    ]

    mock_client = MagicMock()

    async def _get(_url, params=None, **_kwargs):
        method = (params or {}).get("method", "")
        artist = (params or {}).get("artist", "")
        if method == "track.getsimilar":
            return _ok_response(EMPTY_TRACK_SIMILAR)
        if method == "artist.gettoptracks":
            return _ok_response(_top_tracks_payload(artist, [f"T{i}" for i in range(5)]))
        return _ok_response({})

    mock_client.get = AsyncMock(side_effect=_get)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters.lastfm.fetch_lastfm_artist_similars", AsyncMock(return_value=cached_similars)), \
         patch("app.adapters.lastfm.upsert_lastfm_artist_similars", AsyncMock()), \
         patch("app.adapters.lastfm.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = True
        results = await adapter.find_similar("Underground - Track")

    assert len(results) <= LASTFM_FALLBACK_TOTAL_CAP


async def test_fallback_score_ordering_match_times_decay():
    """High-match artist's rank-2 (0.9*0.7=0.63) must outrank low-match artist's
    rank-1 (0.4*1.0=0.40). Asserts the multiplicative — not additive — combine."""
    adapter = LastfmAdapter()
    cached_similars = [
        {"name": "HighMatch", "match": 0.9, "url": "u1"},
        {"name": "LowMatch", "match": 0.4, "url": "u2"},
    ]

    mock_client = MagicMock()

    async def _get(_url, params=None, **_kwargs):
        method = (params or {}).get("method", "")
        artist = (params or {}).get("artist", "")
        if method == "track.getsimilar":
            return _ok_response(EMPTY_TRACK_SIMILAR)
        if method == "artist.gettoptracks":
            return _ok_response(_top_tracks_payload(artist, ["rank1", "rank2", "rank3"]))
        return _ok_response({})

    mock_client.get = AsyncMock(side_effect=_get)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters.lastfm.fetch_lastfm_artist_similars", AsyncMock(return_value=cached_similars)), \
         patch("app.adapters.lastfm.upsert_lastfm_artist_similars", AsyncMock()), \
         patch("app.adapters.lastfm.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = "fake-key"
        mock_settings.lastfm_artist_fallback_enabled = True
        results = await adapter.find_similar("Underground - Track")

    ordering = [(r.artist, r.title) for r in results]
    high_rank2_idx = ordering.index(("HighMatch", "rank2"))
    low_rank1_idx = ordering.index(("LowMatch", "rank1"))
    assert high_rank2_idx < low_rank1_idx, (
        f"Expected HighMatch/rank2 before LowMatch/rank1, got: {ordering}"
    )
