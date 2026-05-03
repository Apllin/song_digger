"""Tests for Last.fm adapter: track.getSimilar parsing and graceful failures."""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.adapters.lastfm import LastfmAdapter, _split_query


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


# ── LastfmAdapter.find_similar ────────────────────────────────────────────────

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
        results = await adapter.find_similar("X - Y")

    assert results == []


async def test_random_techno_track_returns_none():
    adapter = LastfmAdapter()
    assert await adapter.random_techno_track() is None
