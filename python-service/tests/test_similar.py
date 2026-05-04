"""Tests for the core normalization and metadata inference logic in similar.py."""
import pytest
from app.api.routes.similar import (
    _normalize,
    _normalize_title,
    _same_artist,
    _cosine_is_confident,
    _extract_source_label_genre,
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


def test_normalize_title_preserves_remix_marker():
    """(Remix) identifies a different recording — never strip it."""
    assert _normalize_title("Insomnia (Remix)") == "insomnia (remix)"
    assert _normalize_title("Insomnia (Faithless Remix)") == "insomnia (faithless remix)"
    assert _normalize_title("Insomnia [Remix]") == "insomnia [remix]"


def test_normalize_title_preserves_dub_version():
    assert _normalize_title("Strings of Life (Dub)") == "strings of life (dub)"
    assert _normalize_title("Strings of Life (Dub Mix)") == "strings of life (dub mix)"
    assert _normalize_title("Strings of Life (Dub Version)") == "strings of life (dub version)"


def test_normalize_title_preserves_live_version():
    assert _normalize_title("Smalltown Boy (Live)") == "smalltown boy (live)"
    assert (
        _normalize_title("Smalltown Boy (Live at Wembley)")
        == "smalltown boy (live at wembley)"
    )


def test_normalize_title_strips_remaster_year_variants():
    assert _normalize_title("Heroes (Remastered 2017)") == "heroes"
    assert _normalize_title("Heroes [Remastered]") == "heroes"
    assert _normalize_title("Heroes (2017 Remaster)") == "heroes"


def test_normalize_title_handles_both_paren_and_bracket_forms():
    assert _normalize_title("Track (Original Mix)") == "track"
    assert _normalize_title("Track [Original Mix]") == "track"
    assert _normalize_title("Track (feat. Guest)") == "track"
    assert _normalize_title("Track [feat. Guest]") == "track"
    assert _normalize_title("Track (Extended Mix)") == "track"
    assert _normalize_title("Track [Extended Mix]") == "track"


def test_normalize_title_strips_feat_variants():
    base = _normalize_title("Track")
    assert _normalize_title("Track (feat. X)") == base
    assert _normalize_title("Track (ft. X)") == base
    assert _normalize_title("Track (featuring X)") == base


def test_normalize_title_strips_prod_variants():
    base = _normalize_title("Track")
    assert _normalize_title("Track (prod. X)") == base
    assert _normalize_title("Track (produced by X)") == base
    assert _normalize_title("Track [prod. X]") == base


def test_normalize_title_strips_bonus_track():
    base = _normalize_title("Track")
    assert _normalize_title("Track (Bonus Track)") == base
    assert _normalize_title("Track [Bonus Track]") == base


def test_normalize_title_preserves_vip_and_instrumental():
    """VIP, Instrumental, Acoustic, Demo identify distinct recordings."""
    assert _normalize_title("Track (VIP)") != _normalize_title("Track")
    assert _normalize_title("Track (VIP Mix)") != _normalize_title("Track")
    assert _normalize_title("Track (Instrumental)") != _normalize_title("Track")
    assert _normalize_title("Track (Acoustic)") != _normalize_title("Track")
    assert _normalize_title("Track (Demo)") != _normalize_title("Track")


def test_normalize_title_preserves_edit_when_not_radio():
    """Bare (Edit) is a distinct version; only 'Radio Edit' is noise."""
    assert _normalize_title("Track (Edit)") != _normalize_title("Track")
    assert _normalize_title("Track (Radio Edit)") == _normalize_title("Track")


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


# ── _extract_source_label_genre ───────────────────────────────────────────────

def test_extract_source_label_genre_returns_most_common():
    tracks = [
        make_track(label="Pole Group", genre="Techno"),
        make_track(label="Pole Group", genre="Techno"),
        make_track(label="Tresor", genre="Hard Techno"),
    ]
    label, genre = _extract_source_label_genre(tracks)
    assert label == "Pole Group"
    assert genre == "Techno"


def test_extract_source_label_genre_ignores_missing():
    tracks = [
        make_track(label=None, genre=None),
        make_track(label="Pole Group", genre=None),
    ]
    label, genre = _extract_source_label_genre(tracks)
    assert label == "Pole Group"
    assert genre is None


def test_extract_source_label_genre_uses_top_5_only():
    # 6th track shouldn't outvote the first 5.
    tracks = [make_track(label="Pole Group") for _ in range(5)] + [
        make_track(label="Tresor"),
        make_track(label="Tresor"),
        make_track(label="Tresor"),
    ]
    label, _ = _extract_source_label_genre(tracks)
    assert label == "Pole Group"


def test_extract_source_label_genre_empty():
    label, genre = _extract_source_label_genre([])
    assert label is None
    assert genre is None
