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


# ── videos fallback + UGC parsing (TRA-25 follow-up) ─────────────────────────

def _make_search(songs: list[dict], videos: list[dict]):
    """Dispatch ytmusicapi.search by its `filter` kwarg so a test can give
    distinct results for the catalog-songs pass and the UGC-videos fallback."""
    def _search(query, filter, limit):
        return songs if filter == "songs" else videos
    return _search


async def test_find_similar_falls_back_to_videos_for_ugc_track():
    """Track absent from the songs catalog but present as a UGC video upload:
    the adapter must fall back to filter='videos', match against the parsed
    title, seed radio off it, and parse 'Artist - Title' out of UGC results."""
    adapter = YouTubeMusicAdapter()
    song_miss = _ytm_track("wrongvid", "Some Other Song", artist="Baby Ford")
    video_hit = {
        "videoId": "ugcvid",
        "title": "Baby Ford - Dognosematic [Perlon114]",
        "artists": [{"name": "playedby"}],  # uploader channel, not the performer
    }
    seed_radio = {"videoId": "ugcvid", "title": "seed", "artists": [], "thumbnail": []}
    ugc_rec = {
        "videoId": "rvid",
        "title": "Fumiya Tanaka - The Mysterious Pocket",
        "artists": [{"name": "Do Funkk"}],
        "videoType": "MUSIC_VIDEO_TYPE_UGC",
        "thumbnail": [],
    }
    fake_ytm = MagicMock()
    fake_ytm.search.side_effect = _make_search([song_miss], [video_hit])
    fake_ytm.get_watch_playlist.return_value = {"tracks": [seed_radio, ugc_rec]}

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        results = await adapter.find_similar("baby ford - dognosematic", limit=10)

    # Radio seeded off the UGC video, not the wrong catalog song.
    assert fake_ytm.get_watch_playlist.call_args.kwargs["videoId"] == "ugcvid"
    assert len(results) == 1
    # UGC parsing: performer comes from the title, not the uploader channel.
    assert results[0].artist == "Fumiya Tanaka"
    assert results[0].title == "The Mysterious Pocket"


async def test_parse_keeps_catalog_track_with_dash_in_title():
    """A non-UGC (catalog) radio track whose title legitimately contains ' - '
    must NOT be reparsed — the artists field stays authoritative."""
    adapter = YouTubeMusicAdapter()
    seed = _ytm_track("seedvid", "Horses", artist="Some Artist")
    catalog = {
        "videoId": "vidC",
        "title": "Sun - Moon",  # legit title with a dash
        "artists": [{"name": "Real Artist"}],
        "videoType": "MUSIC_VIDEO_TYPE_ATV",
        "thumbnail": [],
    }
    fake_ytm = MagicMock()
    fake_ytm.search.return_value = [_ytm_track("seedvid", "Horses", artist="Some Artist")]
    fake_ytm.get_watch_playlist.return_value = {"tracks": [seed, catalog]}

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        results = await adapter.find_similar("Some Artist - Horses")

    assert results[0].artist == "Real Artist"
    assert results[0].title == "Sun - Moon"


async def test_resolve_seed_returns_parsed_video_seed():
    """resolve_seed falls through songs → videos and returns the parsed
    'Artist - Title' plus the videoId used to seed Cosine."""
    adapter = YouTubeMusicAdapter()
    video_hit = {
        "videoId": "ugcvid",
        "title": "Baby Ford - Dognosematic [Perlon114]",
        "artists": [{"name": "playedby"}],
    }
    fake_ytm = MagicMock()
    fake_ytm.search.side_effect = _make_search([], [video_hit])

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        seed = await adapter.resolve_seed("baby ford - dognosematic")

    assert seed == {
        "videoId": "ugcvid",
        "artist": "Baby Ford",
        "title": "Dognosematic [Perlon114]",
    }


# ── search_songs (raw passthrough used by similar.py source-artist resolution) ───

async def test_search_songs_returns_raw_search_payload():
    adapter = YouTubeMusicAdapter()
    fake_ytm = MagicMock()
    fake_ytm.search.return_value = [{"videoId": "v1", "title": "T", "artists": [{"name": "A"}]}]
    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        out = await adapter.search_songs("query", limit=1)
    assert out[0]["videoId"] == "v1"


# ── videos fallback (songs catalogue miss → niche label uploads) ─────────────

def _ytm_video_search_hit(video_id: str, title: str) -> dict:
    """Shape ytmusicapi returns for `filter=videos` search: title + videoId;
    `artists` carries the uploader channel, not the actual artist."""
    return {"videoId": video_id, "title": title, "artists": [{"name": "uploaderChannel"}]}


async def test_videos_fallback_used_when_songs_catalogue_misses():
    """`The Computer Controlled Minds - Machines Are Working` lives on YT Music
    only as a user-uploaded video. The songs results carry the same artist but
    a different track; the strict matcher rejects them, then videos fallback
    finds the exact title-bearing upload and starts a radio off it."""
    adapter = YouTubeMusicAdapter()
    songs_hits = [
        _ytm_track("songA", "Machines Eat My Body", artist="The Computer Controlled Minds"),
        _ytm_track("songB", "Rubber Foam", artist="The Computer Controlled Minds"),
    ]
    video_hits = [
        _ytm_video_search_hit("vidND", "The Computer Controlled Minds - Machines Are Working [ND002]"),
    ]
    seed = _ytm_track("vidND", "Machines Are Working", artist="The Computer Controlled Minds")
    rec = _ytm_track("rec1", "Phase Sequence", artist="Marcel Dettmann")

    fake_ytm = MagicMock()
    fake_ytm.search.side_effect = [songs_hits, video_hits]
    fake_ytm.get_watch_playlist.return_value = {"tracks": [seed, rec]}

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        results = await adapter.find_similar("The Computer Controlled Minds - Machines Are Working", limit=10)

    assert len(results) == 1
    assert results[0].sourceUrl == "https://music.youtube.com/watch?v=rec1"
    # Two searches: songs first, then videos
    assert fake_ytm.search.call_count == 2
    # Radio started from the videos-fallback videoId
    fake_ytm.get_watch_playlist.assert_called_once()
    assert fake_ytm.get_watch_playlist.call_args.kwargs["videoId"] == "vidND"


async def test_videos_fallback_rejects_partial_token_match():
    """A video whose title contains only some query tokens must NOT seed the
    radio — otherwise unrelated uploads would bleed into recommendations."""
    adapter = YouTubeMusicAdapter()
    video_hits = [
        # Missing "Machines Are Working" tokens entirely
        _ytm_video_search_hit("vidWrong", "The Computer Controlled Minds - Live at Berlin 2024"),
    ]
    fake_ytm = MagicMock()
    fake_ytm.search.side_effect = [[], video_hits]  # songs empty, videos has near-miss

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        results = await adapter.find_similar("The Computer Controlled Minds - Machines Are Working")

    assert results == []
    fake_ytm.get_watch_playlist.assert_not_called()


async def test_videos_fallback_skipped_for_bare_artist_query():
    """Bare-artist queries (no ` - `) must NOT trigger the videos fallback —
    its token-subset matcher would accept almost anything in that mode."""
    adapter = YouTubeMusicAdapter()
    fake_ytm = MagicMock()
    fake_ytm.search.return_value = []  # songs empty for the bare-artist query

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        assert await adapter.find_similar("Some Unknown Artist") == []
    # Exactly one search — videos fallback never attempted.
    assert fake_ytm.search.call_count == 1


async def test_videos_fallback_not_called_when_songs_match():
    """Happy songs match short-circuits the videos search."""
    adapter = YouTubeMusicAdapter()
    seed = _ytm_track("seedvid", "Horses", artist="Oscar Mulero")
    rec = _ytm_track("rec1", "Faceless", artist="Reeko")
    fake_ytm = MagicMock()
    fake_ytm.search.return_value = [_ytm_track("seedvid", "Horses", artist="Oscar Mulero")]
    fake_ytm.get_watch_playlist.return_value = {"tracks": [seed, rec]}

    with patch("app.adapters.youtube_music._ytm", fake_ytm):
        await adapter.find_similar("Oscar Mulero - Horses")

    assert fake_ytm.search.call_count == 1
