"""
Regression tests for bugs found during debugging.

Bug: CosineClub DNS failure was not handled gracefully — confirmed it is caught
     via asyncio.gather(return_exceptions=True), and results from other sources
     (YTM, etc.) must still be returned.
"""
import pytest
from unittest.mock import AsyncMock, patch
from app.api.routes.similar import (
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


# ── CosineClub DNS failure handled gracefully ────────────────────────────────


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
    ):
        source_lists, _source_artist = await _find_by_artist_and_track(
            "Surgeon", "Flatliner", limit=5
        )

    assert isinstance(source_lists, list), "Must return a list even when CosineClub fails"


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
    ):
        source_lists, _source_artist = await _find_by_artist_only(
            "Oscar Mulero", limit=5
        )

    assert isinstance(source_lists, list), "Must return a list even when CosineClub fails"


@pytest.mark.asyncio
async def test_cosine_track_miss_does_not_fall_back_to_artist_seed():
    """Track absent from Cosine under either word order → empty Cosine list, and
    no bare-artist Cosine query. Regression for "BLANKA (ES) - Klock"."""
    # Bare-artist queries bypass the adapter's seed-relevance gate; nothing else does.
    bare_artist_hit = make_track(
        title="Unrelated Techno Thing", artist="Someone Else",
        source="cosine_club", sourceUrl="https://www.youtube.com/watch?v=zzz",
        score=0.9,
    )

    async def fake_cosine_find_similar(query, limit=20):
        return [bare_artist_hit] if " - " not in query else []

    cosine_mock = AsyncMock(side_effect=fake_cosine_find_similar)

    with (
        patch("app.api.routes.similar._cosine.find_similar", new=cosine_mock),
        patch("app.api.routes.similar._ytm.find_similar", new_callable=AsyncMock, return_value=[]),
        patch("app.api.routes.similar._ytm.search_songs", new_callable=AsyncMock, return_value=[]),
        patch("app.api.routes.similar._yandex.find_similar", new_callable=AsyncMock, return_value=[]),
        patch("app.api.routes.similar._lastfm.find_similar", new_callable=AsyncMock, return_value=[]),
        patch("app.api.routes.similar._trackidnet.find_similar", new_callable=AsyncMock, return_value=[]),
    ):
        source_lists, _source_artist = await _find_by_artist_and_track(
            "BLANKA (ES)", "Klock", limit=5
        )

    cosine_list = next(sl for sl in source_lists if sl.source == "cosine_club")
    assert cosine_list.tracks == [], "Cosine must stay empty when it lacks the track"
    # And the bare-artist fallback query must not be issued at all.
    queries = [c.args[0] if c.args else c.kwargs.get("query") for c in cosine_mock.call_args_list]
    assert all(" - " in q for q in queries), f"unexpected bare-artist Cosine query in {queries}"


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
    ):
        source_lists, *_ = await _find_by_artist_and_track("Surgeon", "Flatliner", limit=5)

    ytm_list = next((sl for sl in source_lists if sl.source == "youtube_music"), None)
    assert ytm_list is not None and ytm_list.tracks, \
        "YTM tracks from other artists must be returned when CosineClub fails"
