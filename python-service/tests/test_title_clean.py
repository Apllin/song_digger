"""Tests for clean_title — display-facing service-tag stripping (TRA-27).

Whitelist-only: known service tags (promo banners, vinyl positions, catalogue
tags, label tails, quality markers) are removed; version markers and anything
unrecognised are preserved.
"""
from app.core.title_norm import clean_title


# ── catalogue tags ───────────────────────────────────────────────────────────

def test_catalog_fused_and_spaced():
    assert clean_title("Dognosematic [Perlon114]") == "Dognosematic"
    assert clean_title("Track [Perlon 114]") == "Track"
    assert clean_title("Track [DRUM-01]") == "Track"


def test_catalog_label_with_separator():
    # The exact format the bug reported as not stripped.
    assert clean_title("Gravy Train [Perlon - PERL73]") == "Gravy Train"
    assert clean_title("Marvin Goes Savage Deep [Perlon – PERL114]") == "Marvin Goes Savage Deep"
    assert clean_title("Shaolin Proverb [Soft Evidences / SOFT03]") == "Shaolin Proverb"
    assert clean_title("Soy Griselda [Playedby020]") == "Soy Griselda"
    assert clean_title("Thing [SOMOV010]") == "Thing"


def test_catalog_keeps_version_paren_alongside():
    assert (
        clean_title("When Its Dark (Moonlight Medley) [Perlon - PERL114]")
        == "When Its Dark (Moonlight Medley)"
    )


# ── promo banners ────────────────────────────────────────────────────────────

def test_promo_prefix_colon_and_pipe():
    assert clean_title("PREMIERE: Ignez - Aventurine") == "Ignez - Aventurine"
    assert clean_title("PREMIERE | BENZA - Track") == "BENZA - Track"


def test_promo_bracket_prefix_and_suffix():
    assert clean_title("[FREE DL] MAURER - Thing") == "MAURER - Thing"
    assert clean_title("Banger (FREE DOWNLOAD)") == "Banger"
    assert clean_title("Track [PREMIERE]") == "Track"
    assert clean_title("Track (Out Now)") == "Track"


# ── vinyl positions ──────────────────────────────────────────────────────────

def test_vinyl_position_prefix():
    assert clean_title("C1 Some Artist - Real Title") == "Some Artist - Real Title"
    assert clean_title("A2. Track") == "Track"
    assert clean_title("[B1] Track") == "Track"


def test_vinyl_only_strips_sides_a_to_d():
    # "E2 E4" (Manuel Göttsching) must survive — E is outside the A–D side range.
    assert clean_title("E2 E4") == "E2 E4"


# ── label tails + quality ────────────────────────────────────────────────────

def test_label_tail_and_quality():
    assert clean_title("Cool Track | Tresor") == "Cool Track"
    assert clean_title("Track Name [Divinity Records]") == "Track Name"
    assert clean_title("Some Track [HD]") == "Some Track"
    assert clean_title("Some Track (FULL)") == "Some Track"


# ── version markers preserved ────────────────────────────────────────────────

def test_preserves_version_markers():
    assert clean_title("Insomnia (Remix)") == "Insomnia (Remix)"
    assert clean_title("Strings of Life (Dub)") == "Strings of Life (Dub)"
    assert clean_title("Smalltown Boy (Live at Wembley)") == "Smalltown Boy (Live at Wembley)"
    assert clean_title("Track (VIP)") == "Track (VIP)"
    assert clean_title("Track (Club Mix)") == "Track (Club Mix)"
    assert clean_title("Bailando (NK & David Version)") == "Bailando (NK & David Version)"


def test_preserves_non_catalog_numbers():
    # < 2-digit catalogue floor keeps real "Part N" / "Vol N" titles intact.
    assert clean_title("Track (Part 2)") == "Track (Part 2)"
    assert clean_title("[Part 2] Foo") == "[Part 2] Foo"


def test_versioned_bracket_with_year_survives():
    # The negative guard keeps a versioned bracket even though it has digits.
    assert clean_title("Anthem [Live 2020]") == "Anthem [Live 2020]"


# ── edge cases ───────────────────────────────────────────────────────────────

def test_recording_suffixes_also_stripped_for_display():
    assert clean_title("Collapse (Original Mix)") == "Collapse"
    assert clean_title("Heroes (Remastered 2017)") == "Heroes"


def test_empty_after_strip_returns_empty_string():
    # Caller (route) falls back to the original when this is empty.
    assert clean_title("[PREMIERE]") == ""
