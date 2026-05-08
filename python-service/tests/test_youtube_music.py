"""Tests for the YouTube Music adapter.

ytmusicapi is synchronous; the adapter wraps each call in
asyncio.to_thread, so we patch the module-level `_ytm` instance directly
and assert the find_similar pipeline (search → get_watch_playlist →
parse, with the seed track skipped from index 0).
"""
from unittest.mock import MagicMock, patch

import pytest

from app.adapters.youtube_music import YouTubeMusicAdapter


def _ytm_track(video_id: str, title: str, artist: str = "Some Artist") -> dict:
    """Shape get_watch_playlist returns: artists list, singular `thumbnail`."""
    return {
        "videoId": video_id,
        "title": title,
        "artists": [{"name": artist}],
        "thumbnail": [{"url": f"https://i.ytimg.com/vi/{video_id}/sm.jpg"}],
    }


# ── happy path ───────────────────────────────────────────────────────────────

async def test_find_similar_skips_seed_and_parses_remaining():
    """First track in get_watch_playlist is the seed itself — must be dropped."""
    adapter = YouTubeMusicAdapter()
    seed = _ytm_track("seedvid", "Horses", artist="Oscar Mulero")
    rec1 = _ytm_track("vid1", "Faceless", artist="Reeko")
    rec2 = _ytm_track("vid2", "Adjusted", artist="Architectural")

    fake_ytm = MagicMock()
    fake_ytm.search.return_value = [_ytm_track("seedvid", "Horses", artist="Oscar Mulero")]
    fake_ytm.get_watch_playlist.return_value = {"tracks": [seed, rec1, rec2]}

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        results = await adapter.find_similar("Oscar Mulero - Horses", limit=10)

    assert len(results) == 2
    assert results[0].title == "Faceless"
    assert results[0].artist == "Reeko"
    assert results[0].source == "youtube_music"
    assert results[0].sourceUrl == "https://music.youtube.com/watch?v=vid1"
    # embedUrl uses the YouTube /embed/ form anchored to the frontend origin
    assert results[0].embedUrl.startswith("https://www.youtube.com/embed/vid1")
    assert results[0].coverUrl == "https://i.ytimg.com/vi/vid1/sm.jpg"
    # YTM never populates BPM/key/etc.
    assert results[0].bpm is None
    assert results[0].key is None

    # Verify the radio playlist id is RDAMVM-prefixed (Google's audio-similarity
    # radio, not the short "Up Next" queue).
    fake_ytm.get_watch_playlist.assert_called_once()
    kwargs = fake_ytm.get_watch_playlist.call_args.kwargs
    assert kwargs["videoId"] == "seedvid"
    assert kwargs["playlistId"] == "RDAMVMseedvid"


async def test_find_similar_search_no_hits_returns_empty():
    adapter = YouTubeMusicAdapter()
    fake_ytm = MagicMock()
    fake_ytm.search.return_value = []
    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        assert await adapter.find_similar("Some Unknown - Track") == []
    fake_ytm.get_watch_playlist.assert_not_called()


async def test_find_similar_search_returns_no_video_id_returns_empty():
    """Search hit lacks videoId → adapter cannot start radio. Return []."""
    adapter = YouTubeMusicAdapter()
    fake_ytm = MagicMock()
    # Free-form query (no " - ") bypasses seed validation, so an entry without
    # videoId still reaches the videoId check. With a separator the validation
    # would reject the entry on missing artist/title first.
    fake_ytm.search.return_value = [{"title": "weird"}]  # no videoId key
    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        assert await adapter.find_similar("freeform query") == []
    fake_ytm.get_watch_playlist.assert_not_called()


async def test_find_similar_rejects_seed_that_does_not_match_query():
    """YTM fuzzy search returned an unrelated track — adapter must return []."""
    adapter = YouTubeMusicAdapter()
    fake_ytm = MagicMock()
    fake_ytm.search.return_value = [_ytm_track("vidX", "Ooooooooo", artist="Joy Helder")]

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        assert await adapter.find_similar("Ignez - Aventurine") == []
    fake_ytm.get_watch_playlist.assert_not_called()


# ── parser robustness ───────────────────────────────────────────────────────

async def test_find_similar_drops_tracks_missing_video_id():
    """get_watch_playlist sometimes returns rows without videoId — skip them."""
    adapter = YouTubeMusicAdapter()
    seed = _ytm_track("seedvid", "Horses", artist="Some Artist")
    good = _ytm_track("vidA", "Faceless")
    bad = {"title": "no video id here", "artists": []}

    fake_ytm = MagicMock()
    fake_ytm.search.return_value = [_ytm_track("seedvid", "Horses", artist="Some Artist")]
    fake_ytm.get_watch_playlist.return_value = {"tracks": [seed, good, bad]}

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        results = await adapter.find_similar("Some Artist - Horses", limit=10)

    assert len(results) == 1
    assert results[0].sourceUrl == "https://music.youtube.com/watch?v=vidA"


async def test_find_similar_joins_multiple_artists():
    adapter = YouTubeMusicAdapter()
    seed = _ytm_track("seedvid", "Horses", artist="Some Artist")
    collab = {
        "videoId": "vidC",
        "title": "Joint",
        "artists": [{"name": "A"}, {"name": "B"}],
        "thumbnail": [],
    }
    fake_ytm = MagicMock()
    fake_ytm.search.return_value = [_ytm_track("seedvid", "Horses", artist="Some Artist")]
    fake_ytm.get_watch_playlist.return_value = {"tracks": [seed, collab]}

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        results = await adapter.find_similar("Some Artist - Horses")

    assert len(results) == 1
    assert results[0].artist == "A, B"
    assert results[0].coverUrl is None  # empty thumbnail list


# ── failure mode ────────────────────────────────────────────────────────────

async def test_find_similar_swallows_ytmusicapi_exceptions(capsys):
    """ytmusicapi raises on rate limit / network — adapter returns []."""
    adapter = YouTubeMusicAdapter()
    fake_ytm = MagicMock()
    fake_ytm.search.side_effect = RuntimeError("rate limited")

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        assert await adapter.find_similar("Some Artist - Some Title") == []
    assert "[YouTubeMusic]" in capsys.readouterr().out


# ── search_songs (raw passthrough used by similar.py source-artist resolution) ───

async def test_search_songs_returns_raw_search_payload():
    adapter = YouTubeMusicAdapter()
    fake_ytm = MagicMock()
    fake_ytm.search.return_value = [{"videoId": "v1", "title": "T", "artists": [{"name": "A"}]}]
    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        out = await adapter.search_songs("query", limit=1)
    assert out[0]["videoId"] == "v1"
