"""Tests for the core deduplication and metadata inference logic in similar.py."""
import pytest
from app.api.routes.similar import (
    _normalize,
    _normalize_title,
    _same_artist,
    _deduplicate,
    _extract_source_meta,
)
from app.core.models import TrackMeta


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


def test_normalize_empty():
    assert _normalize("") == ""


# ── _normalize_title ──────────────────────────────────────────────────────────

def test_normalize_title_strips_original_mix():
    assert _normalize_title("Collapse (Original Mix)") == "collapse"


def test_normalize_title_strips_feat():
    assert _normalize_title("Collapse (feat. Someone)") == "collapse"


def test_normalize_title_strips_brackets():
    assert _normalize_title("Collapse [Remastered]") == "collapse"


def test_normalize_title_preserves_regular_parens():
    # Parens that are NOT "original mix" / "feat." should stay
    result = _normalize_title("Collapse (Dark Version)")
    assert "collapse" in result
    assert "dark version" in result


def test_normalize_title_combined():
    result = _normalize_title("GRID (Original Mix) [2024 Remaster]")
    assert result == "grid"


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


# ── _deduplicate ──────────────────────────────────────────────────────────────

def test_deduplicate_removes_same_url():
    t1 = make_track(sourceUrl="https://music.youtube.com/watch?v=aaa")
    t2 = make_track(sourceUrl="https://music.youtube.com/watch?v=aaa")
    result = _deduplicate([t1, t2])
    assert len(result) == 1


def test_deduplicate_keeps_different_tracks():
    """Different artist+title → both survive even if source is the same."""
    t1 = make_track(title="Track A", artist="Artist One", sourceUrl="https://music.youtube.com/watch?v=aaa")
    t2 = make_track(title="Track B", artist="Artist Two", sourceUrl="https://music.youtube.com/watch?v=bbb")
    result = _deduplicate([t1, t2])
    assert len(result) == 2


def test_deduplicate_same_artist_title_different_urls_collapses():
    """Same artist+title from two different YTM URLs = identity duplicate → keep first."""
    t1 = make_track(title="Grid", artist="Oscar Mulero", sourceUrl="https://music.youtube.com/watch?v=aaa")
    t2 = make_track(title="Grid", artist="Oscar Mulero", sourceUrl="https://music.youtube.com/watch?v=bbb")
    result = _deduplicate([t1, t2])
    assert len(result) == 1
    assert result[0].sourceUrl == "https://music.youtube.com/watch?v=aaa"


def test_deduplicate_same_artist_title_different_sources():
    """Same artist+title from YTM and Bandcamp — keep the one with BPM/key."""
    ytm = make_track(
        title="Grid (Original Mix)",
        artist="Oscar Mulero",
        source="youtube_music",
        sourceUrl="https://music.youtube.com/watch?v=aaa",
        bpm=None,
        key=None,
    )
    bandcamp = make_track(
        title="Grid (Original Mix)",
        artist="Oscar Mulero",
        source="bandcamp",
        sourceUrl="https://someartist.bandcamp.com/track/grid",
        bpm=140.0,
        key="8A",
    )
    result = _deduplicate([ytm, bandcamp])
    assert len(result) == 1
    assert result[0].bpm == 140.0
    assert result[0].key == "8A"


def test_deduplicate_prefers_first_when_equal_metadata():
    t1 = make_track(sourceUrl="https://music.youtube.com/watch?v=aaa", bpm=140.0, key="8A")
    t2 = make_track(
        title="Test Track",
        artist="Test Artist",
        source="bandcamp",
        sourceUrl="https://artist.bandcamp.com/track/test",
        bpm=140.0,
        key="8A",
    )
    result = _deduplicate([t1, t2])
    assert len(result) == 1
    assert result[0].sourceUrl == t1.sourceUrl


def test_deduplicate_normalizes_title_variants():
    """'Grid' and 'Grid (Original Mix)' should be treated as the same track."""
    t1 = make_track(title="Grid", artist="Oscar Mulero", sourceUrl="https://music.youtube.com/watch?v=aaa")
    t2 = make_track(title="Grid (Original Mix)", artist="Oscar Mulero", sourceUrl="https://music.youtube.com/watch?v=bbb")
    result = _deduplicate([t1, t2])
    assert len(result) == 1


def test_deduplicate_empty_list():
    assert _deduplicate([]) == []


# ── _extract_source_meta ──────────────────────────────────────────────────────

def test_extract_source_meta_returns_median_bpm():
    tracks = [
        make_track(bpm=138.0, key="8A", score=0.9),
        make_track(bpm=140.0, key="8A", score=0.85),
        make_track(bpm=142.0, key="9A", score=0.8),
    ]
    bpm, key, energy, confident = _extract_source_meta(tracks)
    assert bpm == 140.0  # median of [138, 140, 142]


def test_extract_source_meta_returns_most_common_key():
    tracks = [
        make_track(bpm=140.0, key="8A", score=0.9),
        make_track(bpm=140.0, key="8A", score=0.85),
        make_track(bpm=140.0, key="9A", score=0.8),
    ]
    _, key, _energy, _ = _extract_source_meta(tracks)
    assert key == "8A"


def test_extract_source_meta_confident_above_threshold():
    tracks = [make_track(bpm=140.0, key="8A", score=0.9)]
    _, _, _energy, confident = _extract_source_meta(tracks)
    assert confident is True


def test_extract_source_meta_not_confident_below_threshold():
    tracks = [make_track(bpm=140.0, key="8A", score=0.3)]
    _, _, _energy, confident = _extract_source_meta(tracks)
    assert confident is False


def test_extract_source_meta_no_bpm():
    tracks = [make_track(bpm=None, key=None, score=0.9)]
    bpm, key, _energy, _ = _extract_source_meta(tracks)
    assert bpm is None
    assert key is None


def test_extract_source_meta_empty():
    bpm, key, energy, confident = _extract_source_meta([])
    assert bpm is None
    assert key is None
    assert energy is None
    assert confident is False
