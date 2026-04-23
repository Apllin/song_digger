"""
Regression tests for bugs found during debugging.

Bug 1: _spotify_enabled was not defined → NameError on every /similar request.
Bug 2: CosineClub DNS failure was not handled gracefully — confirmed it is caught
       via asyncio.gather(return_exceptions=True), and results from other sources
       (YTM, Bandcamp) must still be returned.
"""
import pytest
from unittest.mock import AsyncMock, patch
from app.api.routes.similar import (
    _spotify_enabled,
    _find_by_artist_and_track,
    _find_by_artist_only,
)
from app.core.models import TrackMeta


def make_track(**kwargs) -> TrackMeta:
    defaults = dict(
        title="Test Track",
        artist="Test Artist",
        source="youtube_music",
        sourceUrl="https://music.youtube.com/watch?v=abc",
    )
    return TrackMeta(**(defaults | kwargs))


# ── Bug 1: _spotify_enabled ───────────────────────────────────────────────────

def test_spotify_enabled_is_defined():
    """_spotify_enabled must exist and be callable — was missing, caused NameError."""
    assert callable(_spotify_enabled)


def test_spotify_enabled_returns_bool():
    result = _spotify_enabled()
    assert isinstance(result, bool)


# ── Bug 2: CosineClub DNS failure handled gracefully ─────────────────────────

@pytest.mark.asyncio
async def test_find_by_artist_and_track_survives_cosine_dns_error():
    """
    When CosineClub raises a network error (DNS failure), asyncio.gather captures it
    as an exception object. The function must still return a list (not raise).
    """
    ytm_track = make_track(title="YTM Track", artist="Surgeon", source="youtube_music")

    with (
        patch("app.api.routes.similar._cosine.find_similar", new_callable=AsyncMock,
              side_effect=Exception("[Errno 8] nodename nor servname provided")),
        patch("app.api.routes.similar._ytm.find_similar", new_callable=AsyncMock,
              return_value=[ytm_track]),
        patch("app.api.routes.similar._ytm.search_songs", new_callable=AsyncMock,
              return_value=[]),
        patch("app.api.routes.similar._bandcamp_safe", new_callable=AsyncMock,
              return_value=[]),
        patch("app.api.routes.similar._beatport.find_similar", new_callable=AsyncMock,
              return_value=[]),
        patch("app.api.routes.similar._spotify_enabled", return_value=False),
    ):
        tracks, source_artist, bpm, key = await _find_by_artist_and_track(
            "Surgeon", "Flatliner", limit=5
        )

    assert isinstance(tracks, list), "Must return a list even when CosineClub fails"


@pytest.mark.asyncio
async def test_find_by_artist_only_survives_cosine_dns_error():
    """Same DNS resilience check for artist-only mode."""
    ytm_track = make_track(title="YTM Track", artist="Oscar Mulero", source="youtube_music")

    with (
        patch("app.api.routes.similar._cosine.find_similar", new_callable=AsyncMock,
              side_effect=Exception("[Errno 8] nodename nor servname provided")),
        patch("app.api.routes.similar._ytm.find_similar_by_artist", new_callable=AsyncMock,
              return_value=[ytm_track]),
        patch("app.api.routes.similar._ytm.search_songs", new_callable=AsyncMock,
              return_value=[]),
        patch("app.api.routes.similar._spotify_enabled", return_value=False),
    ):
        tracks, source_artist, bpm, key = await _find_by_artist_only("Oscar Mulero", limit=5)

    assert isinstance(tracks, list), "Must return a list even when CosineClub fails"


@pytest.mark.asyncio
async def test_find_by_artist_and_track_returns_ytm_when_cosine_fails():
    """YTM results from OTHER artists must reach the caller even when CosineClub is down.

    ytm_source_search identifies "Surgeon" as the source → source_artist = "Surgeon".
    The similar track by "Oscar Mulero" is a different artist, so it passes the filter.
    """
    ytm_track = make_track(
        title="Some Track", artist="Oscar Mulero", source="youtube_music",
        sourceUrl="https://music.youtube.com/watch?v=xyz"
    )
    # Simulate ytm search_songs returning the source track with correct artist
    ytm_source_result = [{"artists": [{"name": "Surgeon"}], "title": "Flatliner"}]

    with (
        patch("app.api.routes.similar._cosine.find_similar", new_callable=AsyncMock,
              side_effect=Exception("DNS failure")),
        patch("app.api.routes.similar._ytm.find_similar", new_callable=AsyncMock,
              return_value=[ytm_track]),
        patch("app.api.routes.similar._ytm.search_songs", new_callable=AsyncMock,
              return_value=ytm_source_result),
        patch("app.api.routes.similar._bandcamp_safe", new_callable=AsyncMock,
              return_value=[]),
        patch("app.api.routes.similar._beatport.find_similar", new_callable=AsyncMock,
              return_value=[]),
        patch("app.api.routes.similar._spotify_enabled", return_value=False),
    ):
        tracks, _, _, _ = await _find_by_artist_and_track("Surgeon", "Flatliner", limit=5)

    assert any(t.source == "youtube_music" for t in tracks), \
        "YTM tracks from other artists must be returned when CosineClub fails"
