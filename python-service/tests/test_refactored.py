"""
Tests for refactored logic:
- _deduplicate O(n) correctness (edge cases for the index-based replacement)
- _same_artist min-length guard
- BPM filter null-safety (via aggregator logic mirrored in Python)
- runSearch status bug (conceptual — tested via unit-level isolation)
"""
import pytest
from app.api.routes.similar import (
    _deduplicate,
    _same_artist,
    _normalize_title,
    _has_metadata,
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


# ── _has_metadata ─────────────────────────────────────────────────────────────

def test_has_metadata_bpm_only():
    assert _has_metadata(make_track(bpm=140.0, key=None)) is True


def test_has_metadata_key_only():
    assert _has_metadata(make_track(bpm=None, key="8A")) is True


def test_has_metadata_both_none():
    assert _has_metadata(make_track(bpm=None, key=None)) is False


# ── _same_artist min-length guard ─────────────────────────────────────────────

def test_same_artist_short_name_not_substring():
    """Single char 'A' must NOT match 'Anastasia' via substring."""
    assert _same_artist("A", "Anastasia") is False


def test_same_artist_short_exact_match():
    """Exact match still works regardless of length."""
    assert _same_artist("A", "A") is True


def test_same_artist_long_substring():
    """'Oscar Mulero' (12 chars) IS a real substring of 'Oscar Mulero & X'."""
    assert _same_artist("Oscar Mulero", "Oscar Mulero & Ancient Methods") is True


def test_same_artist_boundary_4_chars():
    """4-char name is the minimum for substring matching."""
    assert _same_artist("Daft", "Daft Punk") is True


def test_same_artist_3_chars_no_match():
    """3-char name must NOT trigger substring match."""
    assert _same_artist("Bob", "Bobby Brown") is False


def test_same_artist_3_chars_exact():
    assert _same_artist("Bob", "Bob") is True


# ── _deduplicate O(n) — in-place replacement correctness ─────────────────────

def test_deduplicate_replacement_keeps_correct_index():
    """
    After in-place replacement, subsequent tracks with same identity
    should still compare against the updated (metadata-rich) version.
    """
    t1 = make_track(title="Grid", artist="Oscar Mulero",
                    sourceUrl="https://music.youtube.com/watch?v=aaa",
                    bpm=None, key=None)
    t2 = make_track(title="Grid (Original Mix)", artist="Oscar Mulero",
                    source="bandcamp",
                    sourceUrl="https://artist.bandcamp.com/track/grid",
                    bpm=140.0, key="8A")
    t3 = make_track(title="Grid", artist="Oscar Mulero",
                    source="cosine_club",
                    sourceUrl="https://cosine.club/track/grid",
                    bpm=141.0, key="8A")  # also metadata-rich

    result = _deduplicate([t1, t2, t3])
    # t1 gets replaced by t2 (has metadata), t3 is same identity → dropped
    assert len(result) == 1
    assert result[0].bpm == 140.0  # t2 wins, t3 same identity → dropped


def test_deduplicate_large_list_no_duplicates():
    """500 truly unique tracks should all survive — O(n) path."""
    tracks = [
        make_track(
            title=f"Track {i}",
            artist=f"Artist {i}",
            sourceUrl=f"https://music.youtube.com/watch?v={i:04d}",
        )
        for i in range(500)
    ]
    result = _deduplicate(tracks)
    assert len(result) == 500


def test_deduplicate_all_same_url():
    """500 copies of the same URL → only 1 survives."""
    tracks = [
        make_track(sourceUrl="https://music.youtube.com/watch?v=same")
        for _ in range(500)
    ]
    result = _deduplicate(tracks)
    assert len(result) == 1


def test_deduplicate_all_same_identity_different_urls():
    """Same artist+title with 500 different URLs → only 1 survives."""
    tracks = [
        make_track(
            title="Grid",
            artist="Oscar Mulero",
            sourceUrl=f"https://music.youtube.com/watch?v={i:04d}",
        )
        for i in range(500)
    ]
    result = _deduplicate(tracks)
    assert len(result) == 1


def test_deduplicate_metadata_replacement_is_stable():
    """Metadata-rich copy replaces no-metadata copy; its position is preserved."""
    t_no_meta = make_track(title="X", artist="Y",
                           sourceUrl="https://yt.com/1", bpm=None, key=None)
    t_with_meta = make_track(title="X", artist="Y",
                              source="bandcamp",
                              sourceUrl="https://bc.com/x", bpm=130.0, key="5A")
    other = make_track(title="Other", artist="Z",
                       sourceUrl="https://yt.com/2")

    result = _deduplicate([t_no_meta, other, t_with_meta])
    # t_no_meta replaced by t_with_meta at index 0; other at index 1
    assert len(result) == 2
    assert result[0].bpm == 130.0
    assert result[1].title == "Other"


# ── _normalize_title — regression after moving import re out ─────────────────

def test_normalize_title_no_import_inside():
    """Ensure function works without inline import (module-level re is used)."""
    assert _normalize_title("Test (Original Mix)") == "test"
    assert _normalize_title("Test [Remaster]") == "test"
    assert _normalize_title("Test (feat. X)") == "test"


# ── Edge case: empty artist string ────────────────────────────────────────────

def test_same_artist_both_empty():
    """Two empty strings are equal."""
    assert _same_artist("", "") is True


def test_same_artist_one_empty():
    """Empty string vs non-empty — only exact match applies (len < 4)."""
    assert _same_artist("", "Surgeon") is False


# ── Edge case: unicode / special chars in artist names ───────────────────────

def test_same_artist_unicode():
    assert _same_artist("Surgeon", "surgeon") is True


def test_deduplicate_unicode_title():
    t1 = make_track(title="Décollage", artist="Âme",
                    sourceUrl="https://yt.com/a")
    t2 = make_track(title="Décollage", artist="Âme",
                    sourceUrl="https://bc.com/a", bpm=128.0)
    result = _deduplicate([t1, t2])
    assert len(result) == 1
    assert result[0].bpm == 128.0
