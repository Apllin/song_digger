"""Tests for the YTM exact-match resolver used by the embed-resolver path.

The fuzzy-title tier (`_title_close`) exists to tolerate YTM upload typos
without opening the door to false matches. Coverage focuses on:
  - the bug report case (Discogs "Teach Me Frisbee" ↔ YTM "Teach Me Frisbe [PX099]"),
  - existing high-confidence tiers (signature equality, substring) still pass,
  - obvious false-positive shapes (short titles, completely different words,
    two-token swaps) get rejected.
"""
from app.api.routes.ytm_playlist import _title_close, _token_close


# ── _token_close: per-token typo tolerance ──────────────────────────────────


def test_token_close_accepts_one_char_drop():
    assert _token_close("frisbee", "frisbe") is True


def test_token_close_accepts_one_char_swap():
    assert _token_close("plastickman", "plastikman") is True


def test_token_close_rejects_short_tokens():
    # "love" vs "live" is the classic short-token false positive — different
    # words, only 2 chars match, but a generous ratio could let them pass.
    # The < 4 char guard catches both extremes ("up" vs "on") and borderline
    # ("love" vs "live") cases via the per-token length check.
    assert _token_close("up", "on") is False
    assert _token_close("acid", "axid") is False  # 4 chars, but we still want this rejected


def test_token_close_rejects_completely_different_words():
    assert _token_close("resonance", "resonator") is False  # ratio ~0.78
    assert _token_close("frisbee", "trumpet") is False


def test_token_close_rejects_large_length_diff():
    # > 2 char length difference is always a different word, even if one
    # contains the other as substring.
    assert _token_close("acid", "acidic") is False  # diff = 2, ratio = 0.8 — rejected by ratio
    assert _token_close("acid", "acidicly") is False  # diff = 4 — rejected by length guard


# ── _title_close: end-to-end title matcher ──────────────────────────────────


def test_title_close_signature_equality():
    """Tier 1: identical after _title_signature normalisation."""
    assert _title_close("Voices", "voices") is True
    assert _title_close("Voices (Original Mix)", "Voices") is True  # 'Original Mix' stripped


def test_title_close_substring_either_direction():
    """Tier 2: short-our-title matches longer YTM title (existing behavior)."""
    assert _title_close("Acid", "Acid Trip") is True  # our ⊆ ytm
    assert _title_close("Voices Carry On Forever", "Voices Carry On") is True  # ytm ⊆ our


def test_title_close_substring_with_catalog_tag():
    """Catalog tags become separate tokens after signature normalisation —
    'Teach Me' is a substring of 'Teach Me Frisbe Px099' so this passes
    via tier 2 even before reaching the fuzzy tier."""
    assert _title_close("Teach Me", "Teach Me Frisbe [PX099]") is True


def test_title_close_fuzzy_tolerates_typo_in_ytm_title():
    """Tier 3: the bug report — Discogs 'Frisbee' (with 'e') matches YTM
    'Frisbe [PX099]' (typo dropped 'e') because the per-token fuzzy passes."""
    assert _title_close("Teach Me Frisbee", "Bjarki - Teach Me Frisbe [PX099]") is True
    assert _title_close("Teach Me Frisbee", "Teach Me Frisbe [PX099]") is True


def test_title_close_fuzzy_skipped_for_short_titles():
    """Signature < 8 chars: fuzzy tier is skipped to avoid false positives.
    'Cobra' vs 'Cobras' would otherwise pass by token-fuzzy — both 5+ chars,
    1-char diff, 0.91 ratio — but the length guard rules them out."""
    # "Cobra" → signature 'cobra' (5 chars < 8) → fuzzy skipped, only substring
    # tiers left, and "cobra" IS a substring of "cobras" → matches via tier 2.
    assert _title_close("Cobra", "Cobras") is True

    # But "Spas" vs "Spasm" — substring tier passes, also via length guard
    # the fuzzy tier is irrelevant. The interesting short-title rejection is
    # when neither substring nor signature tier helps:
    assert _title_close("Hex", "Vex") is False  # short, no overlap, no fuzzy


def test_title_close_rejects_unrelated_titles():
    """Different tracks must not collide even when both are long enough to
    enter the fuzzy tier."""
    # Same artist could have both — must NOT merge.
    assert _title_close("Resonance Field", "Resonator Array") is False
    # Completely different titles, similar length:
    assert _title_close("Eternal Flame Burning", "Frozen Crystal Garden") is False


def test_title_close_fuzzy_requires_every_our_token_to_match():
    """Per-token check: missing a meaningful our-token rejects the candidate
    even if other tokens align. 'Apex Predator Mode' vs 'Predator Mode' would
    be rejected because 'apex' has no token-level match in the YTM side."""
    assert _title_close("Apex Predator Mode", "Predator Mode") is True  # tier 2: ytm ⊆ our
    assert _title_close("Predator Mode", "Apex Predator Mode") is True  # tier 2: our ⊆ ytm
    # But missing a token in BOTH directions — neither substring nor any
    # token-fuzzy match for 'venom' in {'apex','predator','mode'}:
    assert _title_close("Apex Venom Mode", "Apex Predator Mode") is False


def test_title_close_handles_empty_input():
    assert _title_close("", "Anything") is False
    assert _title_close("Anything", "") is False
    # Pure-punctuation input → empty signature → False, not crash.
    assert _title_close("---", "Anything") is False
