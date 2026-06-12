"""Tests for the Troi (lb-radio) adapter and its tag/prompt builder.

The lb-radio run (`_run_lb_radio`) and the Postgres external_cache helpers are
the network/DB boundaries — they're patched so the suite stays offline and the
adapter's degradation logic (flag, soft-fail, circuit breaker, serve-stale,
caching) is exercised directly.
"""
from unittest.mock import AsyncMock, patch

import pytest

import app.adapters.troi as troi_mod
from app.adapters.troi import TroiAdapter, _row_to_track, _split_query
from app.config import settings
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


# ── _split_query / _row_to_track ──────────────────────────────────────────────

def test_split_query():
    assert _split_query("Oscar Mulero - Horses") == ("Oscar Mulero", "Horses")
    assert _split_query("Oscar Mulero") == ("Oscar Mulero", None)


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
def _enabled(monkeypatch):
    monkeypatch.setattr(settings, "troi_enabled", True)
    monkeypatch.setattr(settings, "troi_dig_intensity", "hard")


def _patch_cache(fetch_return=None):
    """Patch both cache helpers; fetch returns fetch_return, upsert is a no-op."""
    return (
        patch("app.adapters.troi.fetch_external_cache", AsyncMock(return_value=fetch_return)),
        patch("app.adapters.troi.upsert_external_cache", AsyncMock(return_value=None)),
    )


async def test_disabled_flag_returns_empty_without_running(monkeypatch):
    monkeypatch.setattr(settings, "troi_enabled", False)
    run = patch("app.adapters.troi._run_lb_radio")
    with run as mock_run:
        out = await TroiAdapter().find_similar("Oscar Mulero - Horses")
    assert out == []
    mock_run.assert_not_called()


async def test_happy_path_maps_and_caches(_enabled):
    fetch_p, upsert_p = _patch_cache(fetch_return=None)
    with fetch_p, upsert_p as mock_upsert, patch(
        "app.adapters.troi.asyncio.to_thread", AsyncMock(return_value=ROWS)
    ):
        out = await TroiAdapter().find_similar("Pendle Coven")
    assert [t.artist for t in out] == ["Pendle Coven", "DeepChord"]
    assert all(t.source == "troi" for t in out)
    mock_upsert.assert_awaited_once()


async def test_cache_hit_skips_run(_enabled):
    fetch_p, upsert_p = _patch_cache(fetch_return=ROWS)
    with fetch_p, upsert_p, patch(
        "app.adapters.troi.asyncio.to_thread", AsyncMock()
    ) as mock_thread:
        out = await TroiAdapter().find_similar("Pendle Coven")
    assert len(out) == 2
    mock_thread.assert_not_awaited()


async def test_run_error_serves_stale(_enabled):
    # fresh read (TTL) misses, run raises, stale read (no TTL) returns last-good.
    fetch = AsyncMock(side_effect=[None, ROWS])
    with patch("app.adapters.troi.fetch_external_cache", fetch), patch(
        "app.adapters.troi.upsert_external_cache", AsyncMock()
    ), patch(
        "app.adapters.troi.asyncio.to_thread", AsyncMock(side_effect=RuntimeError("503"))
    ):
        out = await TroiAdapter().find_similar("Pendle Coven")
    assert len(out) == 2  # served from stale cache
    assert fetch.await_count == 2


async def test_run_error_no_stale_returns_empty(_enabled):
    with patch("app.adapters.troi.fetch_external_cache", AsyncMock(return_value=None)), patch(
        "app.adapters.troi.upsert_external_cache", AsyncMock()
    ), patch(
        "app.adapters.troi.asyncio.to_thread", AsyncMock(side_effect=RuntimeError("boom"))
    ):
        out = await TroiAdapter().find_similar("Pendle Coven")
    assert out == []


async def test_circuit_breaker_opens_after_threshold(_enabled):
    # threshold consecutive failures → breaker open → run is skipped entirely.
    with patch("app.adapters.troi.fetch_external_cache", AsyncMock(return_value=None)), patch(
        "app.adapters.troi.upsert_external_cache", AsyncMock()
    ), patch(
        "app.adapters.troi.asyncio.to_thread", AsyncMock(side_effect=RuntimeError("503"))
    ) as mock_thread:
        adapter = TroiAdapter()
        for _ in range(troi_mod._BREAKER_THRESHOLD):
            await adapter.find_similar("Pendle Coven")
        calls_after_trip = mock_thread.await_count
        await adapter.find_similar("Pendle Coven")  # breaker now open
    assert calls_after_trip == troi_mod._BREAKER_THRESHOLD
    assert mock_thread.await_count == troi_mod._BREAKER_THRESHOLD  # no extra run


async def test_empty_prompt_short_circuits(_enabled):
    # whitespace-only seed → empty prompt → no run, no exception.
    with patch("app.adapters.troi.asyncio.to_thread", AsyncMock()) as mock_thread:
        out = await TroiAdapter().find_similar("   ")
    assert out == []
    mock_thread.assert_not_awaited()


async def test_random_techno_track_is_none():
    assert await TroiAdapter().random_techno_track() is None
