"""
Unit tests for app.feature_extraction.cheap.

Pure functions, no mocking. Each test verifies one cell of the feature
matrix described in the C1 spec.
"""
from app.feature_extraction.cheap import (
    _key_compatibility,
    extract_cheap_features,
)


# A reusable "everything present" candidate so tests can override one field
# at a time and assert on the targeted feature without other noise.
def _full_candidate(**overrides):
    base = {
        "bpm": 130.0,
        "key": "8A",
        "energy": 7.0,
        "label": "Pole Group",
        "genre": "techno",
        "embedUrl": "https://example.com/embed/1",
    }
    base.update(overrides)
    return base


def _full_seed():
    return dict(
        seed_bpm=132.0,
        seed_key="8A",
        seed_energy=7.5,
        seed_label="Pole Group",
        seed_genre="techno",
        n_sources=3,
        top_rank=2,
        rrf_score=0.0234,
    )


def test_full_data_all_features_populated():
    feats = extract_cheap_features(candidate=_full_candidate(), **_full_seed())

    assert feats["bpmDelta"] == 2.0
    assert feats["keyCompat"] == 1.0
    assert feats["energyDelta"] == 0.5
    assert feats["labelMatch"] == 1.0
    assert feats["genreMatch"] == 1.0
    assert feats["nSources"] == 3
    assert feats["topRank"] == 2
    assert feats["hasEmbed"] == 1
    assert feats["rrfScore"] == 0.0234


def test_missing_seed_bpm_yields_null_bpm_delta_only():
    seed = _full_seed()
    seed["seed_bpm"] = None
    feats = extract_cheap_features(candidate=_full_candidate(), **seed)

    assert feats["bpmDelta"] is None
    # Non-bpm features remain populated:
    assert feats["keyCompat"] == 1.0
    assert feats["energyDelta"] == 0.5
    assert feats["labelMatch"] == 1.0


def test_missing_candidate_key_yields_null_key_compat():
    feats = extract_cheap_features(
        candidate=_full_candidate(key=None),
        **_full_seed(),
    )
    assert feats["keyCompat"] is None
    # Other features unaffected:
    assert feats["bpmDelta"] == 2.0
    assert feats["energyDelta"] == 0.5


def test_camelot_same_key():
    assert _key_compatibility("8A", "8A") == 1.0
    assert _key_compatibility("12B", "12B") == 1.0


def test_camelot_one_step_same_mode():
    assert _key_compatibility("8A", "9A") == 0.7
    assert _key_compatibility("8A", "7A") == 0.7
    assert _key_compatibility("3B", "4B") == 0.7


def test_camelot_relative_major_minor():
    assert _key_compatibility("8A", "8B") == 0.7
    assert _key_compatibility("12B", "12A") == 0.7


def test_camelot_discordant():
    assert _key_compatibility("8A", "5B") == 0.0
    assert _key_compatibility("1A", "6A") == 0.0
    # Two-step same mode is NOT compatible under our quantization:
    assert _key_compatibility("8A", "10A") == 0.0


def test_camelot_wheel_wrap():
    # 12 ↔ 1 is a wheel wrap, distance 1 not 11:
    assert _key_compatibility("12A", "1A") == 0.7
    assert _key_compatibility("1A", "12A") == 0.7
    assert _key_compatibility("12B", "1B") == 0.7


def test_camelot_invalid_format_returns_none():
    assert _key_compatibility("XYZ", "8A") is None
    assert _key_compatibility("8A", "13A") is None  # out of range
    assert _key_compatibility("0A", "8A") is None   # out of range
    assert _key_compatibility("8C", "8A") is None   # invalid mode
    assert _key_compatibility("", "8A") is None
    assert _key_compatibility("8A", "") is None
    assert _key_compatibility(None, "8A") is None


def test_label_match_case_insensitive():
    feats = extract_cheap_features(
        candidate=_full_candidate(label="pole group"),
        **{**_full_seed(), "seed_label": "Pole Group"},
    )
    assert feats["labelMatch"] == 1.0


def test_label_mismatch():
    feats = extract_cheap_features(
        candidate=_full_candidate(label="Token"),
        **_full_seed(),
    )
    assert feats["labelMatch"] == 0.0


def test_genre_exact_match():
    feats = extract_cheap_features(
        candidate=_full_candidate(genre="TECHNO  "),
        **{**_full_seed(), "seed_genre": "techno"},
    )
    assert feats["genreMatch"] == 1.0


def test_has_embed_zero_when_missing():
    feats = extract_cheap_features(
        candidate=_full_candidate(embedUrl=None),
        **_full_seed(),
    )
    assert feats["hasEmbed"] == 0


def test_structural_features_never_null_even_with_empty_metadata():
    minimal_candidate = {}  # truly nothing
    minimal_seed = dict(
        seed_bpm=None,
        seed_key=None,
        seed_energy=None,
        seed_label=None,
        seed_genre=None,
        n_sources=1,
        top_rank=42,
        rrf_score=0.001,
    )
    feats = extract_cheap_features(candidate=minimal_candidate, **minimal_seed)

    assert feats["bpmDelta"] is None
    assert feats["keyCompat"] is None
    assert feats["energyDelta"] is None
    assert feats["labelMatch"] is None
    assert feats["genreMatch"] is None

    # Structural features must always be defined regardless of metadata gaps:
    assert feats["nSources"] == 1
    assert feats["topRank"] == 42
    assert feats["hasEmbed"] == 0
    assert feats["rrfScore"] == 0.001
