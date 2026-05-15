"""Tests for the Yandex.Music adapter.

The adapter wraps an async ClientAsync from the (reverse-engineered)
`yandex-music` package. We patch `_get_client` to skip the token-driven
lazy-init and stub out the two methods the adapter actually calls:
`client.search(query, type_="track", ...)` and
`client.tracks_similar(seed_id)`.

Soft-degrade contract per python-adapter-pattern skill:
- No client (missing token / package) → return [] without calling `tracks_similar`.
- Search returns no hits → return [].
- Seed validation rejects all candidates → return [], no `tracks_similar` call.
- YandexMusicError or unexpected exception → return [], log with [YandexMusic] prefix.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.adapters.yandex_music import YandexMusicAdapter


def _track(
    track_id: str,
    title: str,
    artist: str = "Some Artist",
    *,
    cover_uri: str | None = "avatars.yandex.net/get-music-content/abc/%%",
    album_id: str | int | None = "album-1",
) -> SimpleNamespace:
    """Minimal Track-shaped object the adapter inspects via getattr."""
    artist_objs = [SimpleNamespace(name=a.strip()) for a in artist.split(",")]
    albums = (
        [SimpleNamespace(id=album_id, cover_uri=cover_uri)] if album_id is not None else []
    )
    return SimpleNamespace(
        id=track_id,
        title=title,
        artists=artist_objs,
        cover_uri=cover_uri,
        albums=albums,
    )


def _search_response(tracks: list) -> SimpleNamespace:
    return SimpleNamespace(tracks=SimpleNamespace(results=tracks))


def _similar_response(tracks: list) -> SimpleNamespace:
    return SimpleNamespace(similar_tracks=tracks)


def _patch_client(adapter: YandexMusicAdapter, *, search, tracks_similar):
    """Stub adapter._get_client so the lazy-init / token check is bypassed."""
    fake_client = SimpleNamespace(
        search=AsyncMock(side_effect=search) if callable(search) else AsyncMock(return_value=search),
        tracks_similar=AsyncMock(side_effect=tracks_similar)
        if callable(tracks_similar)
        else AsyncMock(return_value=tracks_similar),
    )
    adapter._get_client = AsyncMock(return_value=fake_client)
    return fake_client


# ── soft degradation ─────────────────────────────────────────────────────────

async def test_no_client_returns_empty():
    """Missing token / package init failed → adapter no-ops without searching."""
    adapter = YandexMusicAdapter()
    adapter._get_client = AsyncMock(return_value=None)
    assert await adapter.find_similar("Oscar Mulero - Horses") == []


async def test_search_no_hits_returns_empty():
    adapter = YandexMusicAdapter()
    fake = _patch_client(
        adapter,
        search=_search_response([]),
        tracks_similar=AssertionError("must not call tracks_similar"),
    )
    assert await adapter.find_similar("Some Unknown - Track") == []
    fake.tracks_similar.assert_not_called()


async def test_search_tracks_attr_none_returns_empty():
    """Yandex sometimes returns Search with .tracks=None when there are no track hits."""
    adapter = YandexMusicAdapter()
    _patch_client(
        adapter,
        search=SimpleNamespace(tracks=None),
        tracks_similar=AssertionError("must not call"),
    )
    assert await adapter.find_similar("X - Y") == []


# ── happy path ───────────────────────────────────────────────────────────────

async def test_two_step_search_then_similar_returns_parsed_tracks():
    adapter = YandexMusicAdapter()

    seed = _track("seed-1", "Horses", artist="Oscar Mulero")
    sim_a = _track("rec-a", "Faceless", artist="Reeko", album_id="alb-a")
    sim_b = _track(
        "rec-b",
        "Adjusted",
        artist="Architectural",
        cover_uri=None,
        album_id=None,
    )

    fake = _patch_client(
        adapter,
        search=_search_response([seed]),
        tracks_similar=_similar_response([sim_a, sim_b]),
    )

    results = await adapter.find_similar("Oscar Mulero - Horses", limit=20)

    fake.search.assert_awaited_once_with("Oscar Mulero - Horses", type_="track", nocorrect=False)
    fake.tracks_similar.assert_awaited_once_with("seed-1")

    assert len(results) == 2
    assert results[0].title == "Faceless"
    assert results[0].artist == "Reeko"
    assert results[0].source == "yandex_music"
    assert results[0].sourceUrl == "https://music.yandex.ru/album/alb-a/track/rec-a"
    assert results[0].coverUrl == "https://avatars.yandex.net/get-music-content/abc/400x400"
    assert results[0].bpm is None
    assert results[0].key is None
    # Second result has no album_id and no cover_uri — falls back to /track/<id>
    # URL form and a None cover.
    assert results[1].sourceUrl == "https://music.yandex.ru/track/rec-b"
    assert results[1].coverUrl is None


async def test_find_similar_respects_limit():
    adapter = YandexMusicAdapter()
    seed = _track("seed", "T", artist="A")
    sims = [_track(f"r{i}", f"T{i}", artist=f"A{i}") for i in range(10)]
    _patch_client(
        adapter,
        search=_search_response([seed]),
        tracks_similar=_similar_response(sims),
    )
    out = await adapter.find_similar("A - T", limit=3)
    assert len(out) == 3
    assert [r.title for r in out] == ["T0", "T1", "T2"]


async def test_parser_drops_tracks_without_id():
    adapter = YandexMusicAdapter()
    seed = _track("seed", "T", artist="A")
    good = _track("good", "Good", artist="X")
    bad = SimpleNamespace(id=None, title="No id", artists=[], cover_uri=None, albums=[])
    _patch_client(
        adapter,
        search=_search_response([seed]),
        tracks_similar=_similar_response([good, bad]),
    )
    out = await adapter.find_similar("A - T")
    assert [r.title for r in out] == ["Good"]


# ── seed-relevance gate ──────────────────────────────────────────────────────

async def test_seed_rejects_off_topic_first_hit_and_skips_similar_call(capsys):
    """Reproduces the 'Ignez - Aventurine → Joy Helder' bug.

    Yandex.Music's search resolved the query to a wildly unrelated track and
    `tracks_similar()` then returned non-techno recommendations. The adapter
    must reject the phantom seed and never call `tracks_similar`.
    """
    adapter = YandexMusicAdapter()
    seed = _track("phantom", "Ooooooooo", artist="Joy Helder")
    fake = _patch_client(
        adapter,
        search=_search_response([seed]),
        tracks_similar=AssertionError("must not call — seed rejected"),
    )

    assert await adapter.find_similar("Ignez - Aventurine") == []
    fake.tracks_similar.assert_not_called()
    assert "no seed matched" in capsys.readouterr().out


async def test_seed_picks_second_candidate_when_first_is_off_topic():
    """If the top hit is fuzzy noise but a later hit matches, use the later one."""
    adapter = YandexMusicAdapter()
    wrong = _track("wrong", "Some Soul Song", artist="Linda Jones")
    right = _track("right", "Horses", artist="Oscar Mulero")
    sim = _track("rec", "Faceless", artist="Reeko")
    _patch_client(
        adapter,
        search=_search_response([wrong, right]),
        tracks_similar=_similar_response([sim]),
    )
    out = await adapter.find_similar("Oscar Mulero - Horses")
    assert len(out) == 1
    assert out[0].artist == "Reeko"


async def test_seed_scans_at_most_first_five_candidates():
    """Validation should not look past SEED_CANDIDATES to find a match."""
    adapter = YandexMusicAdapter()
    # Six off-topic + a matching seventh; the matching one must NOT be picked.
    wrong = [_track(f"w{i}", f"Wrong{i}", artist="Phantom") for i in range(6)]
    matching = _track("late", "Horses", artist="Oscar Mulero")
    fake = _patch_client(
        adapter,
        search=_search_response(wrong + [matching]),
        tracks_similar=AssertionError("must not call"),
    )
    assert await adapter.find_similar("Oscar Mulero - Horses") == []
    fake.tracks_similar.assert_not_called()


async def test_bare_artist_query_picks_first_track_by_that_artist():
    """A bare-artist query (no ' - ') seeds off the first candidate whose
    artist matches — i.e. the first track by that artist in the search hits."""
    adapter = YandexMusicAdapter()
    off = _track("off", "Oscar's Theme", artist="Some Other Soul")
    right = _track("right", "Horses", artist="Oscar Mulero")
    sim = _track("rec", "Faceless", artist="Reeko")
    fake = _patch_client(
        adapter,
        search=_search_response([off, right]),
        tracks_similar=_similar_response([sim]),
    )
    out = await adapter.find_similar("Oscar Mulero")
    assert len(out) == 1
    assert out[0].artist == "Reeko"
    fake.tracks_similar.assert_awaited_once_with("right")


async def test_bare_artist_query_returns_empty_when_no_artist_match(capsys):
    """Bare-artist query with no candidate by that artist → drop the source."""
    adapter = YandexMusicAdapter()
    fake = _patch_client(
        adapter,
        search=_search_response([_track("x", "Whatever", artist="Whoever")]),
        tracks_similar=AssertionError("must not call"),
    )
    assert await adapter.find_similar("Chontane") == []
    fake.tracks_similar.assert_not_called()
    assert "no seed matched" in capsys.readouterr().out


async def test_artist_title_query_requires_exact_title_match(capsys):
    """"Artist - Title" query with no exact title match → drop the source."""
    adapter = YandexMusicAdapter()
    # Same artist, different track — under the new rules this is no longer
    # a loose match.
    fake = _patch_client(
        adapter,
        search=_search_response([_track("wrong", "Horses (VIP Mix)", artist="Oscar Mulero")]),
        tracks_similar=AssertionError("must not call"),
    )
    assert await adapter.find_similar("Oscar Mulero - Horses") == []
    fake.tracks_similar.assert_not_called()
    assert "no seed matched" in capsys.readouterr().out


async def test_seed_match_tolerates_diacritics_and_collaborators():
    """'Óscar Mulero' query matches an 'Oscar Mulero & Ancient Methods' hit."""
    adapter = YandexMusicAdapter()
    seed = _track("seed", "Horses (Original Mix)", artist="Oscar Mulero, Ancient Methods")
    _patch_client(
        adapter,
        search=_search_response([seed]),
        tracks_similar=_similar_response([]),
    )
    # Empty similars list confirms we *reached* tracks_similar (no rejection).
    assert await adapter.find_similar("Óscar Mulero - Horses") == []


# ── failure modes ────────────────────────────────────────────────────────────

async def test_yandex_music_error_during_similar_returns_empty(capsys):
    from app.adapters.yandex_music import YandexMusicError

    adapter = YandexMusicAdapter()
    seed = _track("seed", "T", artist="A")

    def _raise(_id):
        raise YandexMusicError("upstream 502")

    _patch_client(
        adapter,
        search=_search_response([seed]),
        tracks_similar=_raise,
    )
    assert await adapter.find_similar("A - T") == []
    assert "[YandexMusic]" in capsys.readouterr().out


async def test_unexpected_exception_returns_empty(capsys):
    adapter = YandexMusicAdapter()

    def _raise(*_a, **_kw):
        raise RuntimeError("network blew up")

    _patch_client(
        adapter,
        search=_raise,
        tracks_similar=AssertionError("must not call"),
    )
    assert await adapter.find_similar("A - T") == []
    out = capsys.readouterr().out
    assert "[YandexMusic]" in out
    assert "unexpected" in out
