"""Tests for the core normalization and metadata inference logic in similar.py."""
import pytest
import app.api.routes.similar as similar_module
from app.api.routes.similar import (
    _normalize,
    _same_artist,
    _cosine_is_confident,
    _spread_unique_artists,
    _normalize_source_titles,
)
from app.core.models import TrackMeta, SourceList
from app.core.title_llm import CanonicalTitle


def make_track(**kwargs) -> TrackMeta:
    defaults = dict(
        title="Test Track",
        artist="Test Artist",
        source="youtube_music",
        sourceUrl="https://music.youtube.com/watch?v=abc123",
    )
    return TrackMeta(**(defaults | kwargs))


# ── _normalize ────────────────────────────────────────────────────────────────

def test_normalize_lowercases_and_strips():
    assert _normalize("  Oscar Mulero  ") == "oscar mulero"


def test_normalize_strips_diacritics():
    # Mirrors web/lib/aggregator.ts:normalizeArtist diacritic strip — without
    # this, "Óscar Mulero" tokens won't match "Oscar Mulero" in _same_artist
    # and the seed-artist filter silently misses one of them.
    assert _normalize("Óscar Mulero") == "oscar mulero"
    assert _normalize("Étienne de Crécy") == "etienne de crecy"
    assert _normalize("Björk") == "bjork"


def test_same_artist_handles_diacritics():
    # Direct symptom: source returns "Óscar Mulero" while seed is the canonical
    # "Oscar Mulero" — must filter as same artist.
    assert _same_artist("Óscar Mulero", "Oscar Mulero") is True
    assert _same_artist("Oscar Mulero", "Óscar Mulero") is True


def test_normalize_empty():
    assert _normalize("") == ""


# ── _normalize_source_titles ──────────────────────────────────────────────────

def _make_canon(artist="Test Artist", title="Test Track", ak="test artist", tk="test track"):
    return CanonicalTitle(
        artist=artist, title=title,
        artist_key=ak, title_key=tk,
        artist_entities=[ak],
    )


async def test_normalize_source_titles_fills_keys(monkeypatch):
    """Tracks returned by _normalize_source_titles carry titleKey and artistKey."""
    canon = _make_canon(artist="Burial", title="Archangel", ak="burial", tk="archangel")

    async def _fake_normalize(items):
        return [canon for _ in items]

    monkeypatch.setattr(similar_module, "normalize_titles", _fake_normalize)
    sl = SourceList(source="youtube_music", tracks=[make_track(artist="Burial", title="Archangel (Original Mix)")])
    result = await _normalize_source_titles([sl])
    t = result[0].tracks[0]
    assert t.titleKey == "archangel"
    assert t.artistKey == "burial"
    assert t.title == "Archangel"
    assert t.artist == "Burial"


async def test_normalize_source_titles_empty_returns_unchanged(monkeypatch):
    """Empty source_lists passes through without calling normalize_titles."""
    async def _should_not_call(items):
        raise AssertionError("normalize_titles should not be called for empty input")

    monkeypatch.setattr(similar_module, "normalize_titles", _should_not_call)
    result = await _normalize_source_titles([SourceList(source="youtube_music", tracks=[])])
    assert result[0].tracks == []


async def test_normalize_source_titles_batches_all_sources(monkeypatch):
    """All tracks across all sources are normalized in one call."""
    calls = []

    async def _fake_normalize(items):
        calls.append(len(items))
        return [_make_canon() for _ in items]

    monkeypatch.setattr(similar_module, "normalize_titles", _fake_normalize)
    sls = [
        SourceList(source="cosine_club", tracks=[make_track(), make_track()]),
        SourceList(source="lastfm", tracks=[make_track()]),
    ]
    await _normalize_source_titles(sls)
    assert calls == [3]  # one batched call for all 3 tracks


# ── _same_artist ──────────────────────────────────────────────────────────────

def test_same_artist_exact_match():
    assert _same_artist("Oscar Mulero", "Oscar Mulero") is True


def test_same_artist_case_insensitive():
    assert _same_artist("oscar mulero", "Oscar Mulero") is True


def test_same_artist_substring():
    # "Oscar Mulero" is contained in "Oscar Mulero & Ancient Methods"
    assert _same_artist("Oscar Mulero", "Oscar Mulero & Ancient Methods") is True


def test_same_artist_different():
    assert _same_artist("Oscar Mulero", "Ancient Methods") is False


# ── _cosine_is_confident ──────────────────────────────────────────────────────

def test_cosine_is_confident_above_threshold():
    tracks = [make_track(score=0.9)]
    assert _cosine_is_confident(tracks) is True


def test_cosine_is_confident_below_threshold():
    tracks = [make_track(score=0.3)]
    assert _cosine_is_confident(tracks) is False


def test_cosine_is_confident_empty():
    assert _cosine_is_confident([]) is False


def test_cosine_is_confident_no_scores():
    tracks = [make_track(score=None)]
    assert _cosine_is_confident(tracks) is False


# ── _spread_unique_artists ────────────────────────────────────────────────────

def test_spread_unique_artists_picks_high_mid_low():
    tracks = [make_track(artist=f"A{i}") for i in range(7)]
    assert _spread_unique_artists(tracks) == ["A0", "A3", "A6"]


def test_spread_unique_artists_small_pool_returns_all():
    tracks = [make_track(artist="A"), make_track(artist="B")]
    assert _spread_unique_artists(tracks) == ["A", "B"]


def test_spread_unique_artists_dedupes_by_normalized_form():
    tracks = [
        make_track(artist="Surgeon"),
        make_track(artist="surgeon"),
        make_track(artist="Lakker"),
    ]
    assert _spread_unique_artists(tracks) == ["Surgeon", "Lakker"]


def test_spread_unique_artists_empty():
    assert _spread_unique_artists([]) == []
