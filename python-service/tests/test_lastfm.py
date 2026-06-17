"""Tests for Last.fm adapter: track.getSimilar parsing and graceful failures,
and the artist-level fallback used when track-level returns 0 results.

Caching was removed from the adapter (it now lives at the /similar endpoint),
so every path here is a direct API read — the only boundary patched is httpx.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.adapters.lastfm import (
    LASTFM_FALLBACK_TOTAL_CAP,
    LastfmAdapter,
    _pick_fallback_tracks,
)
from app.core.models import ParsedQuery


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
    return patch("app.adapters._http.httpx.AsyncClient", return_value=mock_client)


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
        "app.adapters._http.httpx.AsyncClient", return_value=mock_client
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
        results = await adapter.find_similar(ParsedQuery("Oscar Mulero", "Horses"))

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
    # Low-match tracks are NOT filtered out — we trust Last.fm's ordering.
    assert results[2].title == "Static"
    assert results[2].score == pytest.approx(0.2710)


async def test_find_similar_no_api_key_returns_empty():
    adapter = LastfmAdapter()
    mock_client = MagicMock()
    mock_client.get = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters._http.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = ""
        results = await adapter.find_similar(ParsedQuery("Oscar Mulero", "Horses"))

    assert results == []
    mock_client.get.assert_not_called()


async def test_find_similar_swallows_network_errors():
    adapter = LastfmAdapter()
    mock_client = MagicMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("boom"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters._http.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = "fake-key"
        results = await adapter.find_similar(ParsedQuery("X", "Y"))

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
    """A non-empty track.getSimilar short-circuits before artist.getSimilar is
    ever called."""
    adapter = LastfmAdapter()
    mock_client, client_patch = _patch_method_router({
        "track.getsimilar": SIMILAR_RESPONSE,
        # If we did fall through, this would dominate; assertion below checks we don't
        "artist.getsimilar": _artist_similar_payload([("X", 0.9)]),
    })
    with patch("app.adapters.lastfm.settings") as mock_settings, client_patch:
        mock_settings.lastfm_api_key = "fake-key"
        results = await adapter.find_similar(ParsedQuery("Oscar Mulero", "Horses"))

    assert len(results) == 3
    assert results[0].title == "Glance"
    methods_called = [c.kwargs["params"]["method"] for c in mock_client.get.call_args_list]
    assert methods_called == ["track.getsimilar"]


async def test_artist_only_query_goes_straight_to_fallback():
    """Query without a track skips track.getSimilar and goes to artist path."""
    adapter = LastfmAdapter()
    mock_client, client_patch = _patch_method_router({
        "artist.getsimilar": _artist_similar_payload([("Reeko", 0.9)]),
        "artist.gettoptracks": _top_tracks_payload("Reeko", ["A", "B", "C"]),
    })
    with patch("app.adapters.lastfm.settings") as mock_settings, client_patch:
        mock_settings.lastfm_api_key = "fake-key"
        results = await adapter.find_similar(ParsedQuery("Oscar Mulero"))

    assert results, "artist-only query should produce fallback results"
    assert all(r.artist == "Reeko" for r in results)
    methods_called = [c.kwargs["params"]["method"] for c in mock_client.get.call_args_list]
    assert "track.getsimilar" not in methods_called
    assert "artist.getsimilar" in methods_called


async def test_fallback_calls_artist_getsimilar_then_toptracks():
    """Empty track-level result falls through to artist.getSimilar +
    artist.getTopTracks, producing fallback tracks."""
    adapter = LastfmAdapter()
    mock_client, client_patch = _patch_method_router({
        "track.getsimilar": EMPTY_TRACK_SIMILAR,
        "artist.getsimilar": _artist_similar_payload([("Reeko", 0.95), ("Exium", 0.80)]),
        "artist.gettoptracks": _top_tracks_payload("Reeko", ["A", "B", "C"]),
    })
    with patch("app.adapters.lastfm.settings") as mock_settings, client_patch:
        mock_settings.lastfm_api_key = "fake-key"
        results = await adapter.find_similar(ParsedQuery("Underground", "Track"))

    assert results, "fallback should have produced tracks"
    methods_called = [c.kwargs["params"]["method"] for c in mock_client.get.call_args_list]
    assert "artist.getsimilar" in methods_called
    assert "artist.gettoptracks" in methods_called


async def test_fallback_artist_getsimilar_error_returns_empty():
    """When artist.getSimilar errors out, the adapter soft-degrades to []."""
    adapter = LastfmAdapter()
    mock_client, client_patch = _patch_method_router(
        {"track.getsimilar": EMPTY_TRACK_SIMILAR},
        error_for={"artist.getsimilar"},
    )
    with patch("app.adapters.lastfm.settings") as mock_settings, client_patch:
        mock_settings.lastfm_api_key = "fake-key"
        results = await adapter.find_similar(ParsedQuery("Underground", "Track"))

    assert results == []


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
         patch("app.adapters._http.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = "fake-key"
        results = await adapter.find_similar(ParsedQuery("Underground", "Track"))

    assert len(results) == 2
    assert all(r.artist == "Reeko" for r in results)


async def test_fallback_caps_total_contribution():
    """20 similar artists × 5 tracks each = 100 candidates; output must not
    exceed LASTFM_FALLBACK_TOTAL_CAP (30)."""
    adapter = LastfmAdapter()
    artist_payload = _artist_similar_payload(
        [(f"Artist{i}", 0.9 - i * 0.01) for i in range(20)]
    )

    mock_client = MagicMock()

    async def _get(_url, params=None, **_kwargs):
        method = (params or {}).get("method", "")
        artist = (params or {}).get("artist", "")
        if method == "track.getsimilar":
            return _ok_response(EMPTY_TRACK_SIMILAR)
        if method == "artist.getsimilar":
            return _ok_response(artist_payload)
        if method == "artist.gettoptracks":
            return _ok_response(_top_tracks_payload(artist, [f"T{i}" for i in range(5)]))
        return _ok_response({})

    mock_client.get = AsyncMock(side_effect=_get)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters._http.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = "fake-key"
        results = await adapter.find_similar(ParsedQuery("Underground", "Track"))

    assert len(results) <= LASTFM_FALLBACK_TOTAL_CAP


async def test_fallback_score_ordering_match_times_decay():
    """High-match artist's rank-2 (0.9*0.7=0.63) must outrank low-match artist's
    rank-1 (0.4*1.0=0.40). Asserts the multiplicative — not additive — combine."""
    adapter = LastfmAdapter()
    artist_payload = _artist_similar_payload([("HighMatch", 0.9), ("LowMatch", 0.4)])

    mock_client = MagicMock()

    async def _get(_url, params=None, **_kwargs):
        method = (params or {}).get("method", "")
        artist = (params or {}).get("artist", "")
        if method == "track.getsimilar":
            return _ok_response(EMPTY_TRACK_SIMILAR)
        if method == "artist.getsimilar":
            return _ok_response(artist_payload)
        if method == "artist.gettoptracks":
            return _ok_response(_top_tracks_payload(artist, ["rank1", "rank2", "rank3"]))
        return _ok_response({})

    mock_client.get = AsyncMock(side_effect=_get)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("app.adapters.lastfm.settings") as mock_settings, \
         patch("app.adapters._http.httpx.AsyncClient", return_value=mock_client):
        mock_settings.lastfm_api_key = "fake-key"
        results = await adapter.find_similar(ParsedQuery("Underground", "Track"))

    ordering = [(r.artist, r.title) for r in results]
    high_rank2_idx = ordering.index(("HighMatch", "rank2"))
    low_rank1_idx = ordering.index(("LowMatch", "rank1"))
    assert high_rank2_idx < low_rank1_idx, (
        f"Expected HighMatch/rank2 before LowMatch/rank1, got: {ordering}"
    )


# ── _pick_fallback_tracks ─────────────────────────────────────────────────────

def test_pick_fallback_tracks_short_list_returns_all():
    tracks = [{"name": "a"}, {"name": "b"}]
    assert _pick_fallback_tracks(tracks) == tracks


def test_pick_fallback_tracks_keeps_most_popular_plus_two_random():
    tracks = [{"name": str(i)} for i in range(10)]
    picked = _pick_fallback_tracks(tracks)
    assert len(picked) == 3
    assert picked[0] == {"name": "0"}  # most-popular track preserved at front
    assert all(t in tracks[1:] for t in picked[1:])
    assert len({t["name"] for t in picked}) == 3  # no duplicates
