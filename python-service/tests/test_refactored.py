"""
Tests for refactored logic in similar.py:
- _same_artist min-length / token guards
- _normalize_title regression after moving import re out
"""
import pytest
from app.api.routes.similar import (
    _same_artist,
    _normalize_title,
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
