"""Tests for the Troi (lb-radio) adapter and its tag/prompt builder.

The lb-radio run (`_run_lb_radio`) is the network boundary — it's patched so the
suite stays offline and the adapter's degradation logic (soft-fail, circuit
breaker) is exercised directly. Result caching lives at the /similar endpoint,
not in the adapter, so there is nothing to patch on the DB side.
"""
from unittest.mock import AsyncMock, patch

import pytest

import app.adapters.troi as troi_mod
from app.adapters.troi import TroiAdapter, _row_to_track
from app.config import settings
from app.core.models import ParsedQuery
from app.services.troi_tags import (
    build_lb_radio_prompt,
    dig_intensity_to_mode,
    styles_to_tags,
)


# ── tag mapping + prompt builder ──────────────────────────────────────────────

def test_dig_intensity_named_to_mode():
    assert dig_intensity_to_mode("easy") == "easy"
    assert dig_intensity_to_mode("hard") == "hard"
    assert dig_intensity_to_mode("obscure") == "hard"
    assert dig_intensity_to_mode("unknown-value") == "medium"


def test_dig_intensity_numeric_to_mode():
    assert dig_intensity_to_mode(0.1) == "easy"
    assert dig_intensity_to_mode(0.5) == "medium"
    assert dig_intensity_to_mode(0.9) == "hard"


def test_styles_to_tags_maps_and_dedups():
    tags = styles_to_tags(["Hypnotic Techno", "Dub Techno"])
    # both map onto "techno"; it must appear once, mapped tags preserved in order
    assert tags[0] == "hypnotic techno"
    assert tags.count("techno") == 1
    assert "dub techno" in tags


def test_styles_to_tags_drops_unmapped():
    assert styles_to_tags(["Some Made Up Style"]) == []


def test_build_prompt_mode_shifts_with_intensity():
    # Acceptance: changing dig_intensity shifts easy↔hard for the same seed.
    _, easy_mode = build_lb_radio_prompt("Oscar Mulero", dig_intensity="easy")
    _, hard_mode = build_lb_radio_prompt("Oscar Mulero", dig_intensity="hard")
    assert easy_mode == "easy"
    assert hard_mode == "hard"


def test_build_prompt_combines_artist_and_tags():
    prompt, _ = build_lb_radio_prompt(
        "Oscar Mulero", discogs_styles=["Hypnotic Techno"], dig_intensity="hard"
    )
    assert "artist:(Oscar Mulero)" in prompt
    assert "tag:(" in prompt
    assert "hypnotic techno" in prompt


def test_build_prompt_artist_only_when_no_styles():
    prompt, _ = build_lb_radio_prompt("Oscar Mulero", discogs_styles=None)
    assert prompt == "artist:(Oscar Mulero)"


def test_build_prompt_empty_when_no_seed():
    prompt, _ = build_lb_radio_prompt("", discogs_styles=[])
    assert prompt == ""


def test_build_prompt_sanitizes_grammar_chars():
    # Parens/colons in the seed would break the lb-radio grammar.
    prompt, _ = build_lb_radio_prompt("DJ (Hidden): Live")
    assert "(" not in prompt.replace("artist:(", "").replace(")", "")
    assert prompt.startswith("artist:(")


# ── _row_to_track ─────────────────────────────────────────────────────────────

def test_row_to_track_maps_mbid_to_mb_url():
    tm = _row_to_track({"mbid": "abc-123", "title": "Track", "artist": "Artist"})
    assert tm is not None
    assert tm.source == "troi"
    assert tm.sourceUrl == "https://musicbrainz.org/recording/abc-123"
    assert tm.title == "Track" and tm.artist == "Artist"


def test_row_to_track_drops_incomplete_rows():
    assert _row_to_track({"mbid": "", "title": "T", "artist": "A"}) is None
    assert _row_to_track({"mbid": "x", "title": "", "artist": "A"}) is None
    assert _row_to_track({"mbid": "x", "title": "T", "artist": ""}) is None


# ── adapter behaviour ─────────────────────────────────────────────────────────

ROWS = [
    {"mbid": "m1", "title": "Iamnoman", "artist": "Pendle Coven"},
    {"mbid": "m2", "title": "Gliding", "artist": "DeepChord"},
]


@pytest.fixture(autouse=True)
def _reset_breaker():
    troi_mod._breaker.record_success()
    yield
    troi_mod._breaker.record_success()


@pytest.fixture
def _dig_hard(monkeypatch):
    monkeypatch.setattr(settings, "troi_dig_intensity", "hard")


async def test_happy_path_maps_rows(_dig_hard):
    with patch("app.adapters.troi.asyncio.to_thread", AsyncMock(return_value=ROWS)):
        out = await TroiAdapter().find_similar(ParsedQuery("Pendle Coven"))
    assert [t.artist for t in out] == ["Pendle Coven", "DeepChord"]
    assert all(t.source == "troi" for t in out)


async def test_run_error_returns_empty(_dig_hard):
    with patch(
        "app.adapters.troi.asyncio.to_thread", AsyncMock(side_effect=RuntimeError("boom"))
    ):
        out = await TroiAdapter().find_similar(ParsedQuery("Pendle Coven"))
    assert out == []


async def test_circuit_breaker_opens_after_threshold(_dig_hard):
    # threshold consecutive failures → breaker open → run is skipped entirely.
    with patch(
        "app.adapters.troi.asyncio.to_thread", AsyncMock(side_effect=RuntimeError("503"))
    ) as mock_thread:
        adapter = TroiAdapter()
        for _ in range(troi_mod._BREAKER_THRESHOLD):
            await adapter.find_similar(ParsedQuery("Pendle Coven"))
        calls_after_trip = mock_thread.await_count
        await adapter.find_similar(ParsedQuery("Pendle Coven"))  # breaker now open
    assert calls_after_trip == troi_mod._BREAKER_THRESHOLD
    assert mock_thread.await_count == troi_mod._BREAKER_THRESHOLD  # no extra run


async def test_empty_prompt_short_circuits(_dig_hard):
    # whitespace-only seed → empty prompt → no run, no exception.
    with patch("app.adapters.troi.asyncio.to_thread", AsyncMock()) as mock_thread:
        out = await TroiAdapter().find_similar(ParsedQuery("   "))
    assert out == []
    mock_thread.assert_not_awaited()


async def test_random_techno_track_is_none():
    assert await TroiAdapter().random_techno_track() is None


# ── honesty guard: _run_lb_radio drops non-similarity fallback ────────────────

from types import SimpleNamespace

from app.adapters.troi import _run_lb_radio


def _fake_patch(feedback: list[str], recordings: list[dict]):
    """Build a fake LBRadioPatch class whose instances expose the bits
    _run_lb_radio reads: generate_playlist() and user_feedback()."""
    recs = [
        SimpleNamespace(mbid=r["mbid"], name=r["title"], artist_credit=SimpleNamespace(name=r["artist"]))
        for r in recordings
    ]
    playlist = SimpleNamespace(playlists=[SimpleNamespace(recordings=recs)])

    class _FakePatch:
        def __init__(self, args):
            pass

        def generate_playlist(self):
            return playlist

        def user_feedback(self):
            return feedback

    return _FakePatch


def test_run_lb_radio_drops_no_similar_artists_fallback():
    # lb-radio produced recordings but flagged the seed has no CF neighbours —
    # that's genre/own-artist fill, not similarity. Guard must return [].
    fake = _fake_patch(
        feedback=["Using seed artist Joe Milli only, since this artist has no similar artists (yet)."],
        recordings=[{"mbid": "m1", "title": "Flute Dub", "artist": "Joe Milli"}],
    )
    with patch("troi.patches.lb_radio.LBRadioPatch", fake):
        assert _run_lb_radio("hard", "artist:(Joe Milli)", 10) == []


def test_run_lb_radio_keeps_real_cf_similars():
    # Clean feedback (real CF neighbours) → recordings are surfaced.
    fake = _fake_patch(
        feedback=["artist: using artist Aphex Twin and similar artists."],
        recordings=[{"mbid": "m1", "title": "The Pining", "artist": "Clark"}],
    )
    with patch("troi.patches.lb_radio.LBRadioPatch", fake):
        rows = _run_lb_radio("hard", "artist:(Aphex Twin)", 10)
    assert [r["artist"] for r in rows] == ["Clark"]
