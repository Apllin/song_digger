"""
Unit tests for app.feature_extraction.cheap.

Pure functions, no mocking. Each test verifies one cell of the feature
matrix described in the C1 spec.
"""
from app.feature_extraction.cheap import (
    _key_compatibility,
    extract_cheap_features,
)
from app.feature_extraction.discogs import (
    artist_corelease,
    derive_collaborators,
    normalize_artist,
    year_proximity,
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


# ── C2 features (Discogs-derived) ────────────────────────────────────────────


def test_year_proximity_same_year_is_one():
    assert year_proximity(2018, 2018) == 1.0


def test_year_proximity_one_year_apart_is_half():
    assert year_proximity(2018, 2019) == 0.5
    assert year_proximity(2019, 2018) == 0.5


def test_year_proximity_decays_with_distance():
    # 5 years apart → 1/6 ≈ 0.1667
    assert abs(year_proximity(2015, 2020) - (1 / 6)) < 1e-9


def test_year_proximity_returns_none_when_either_year_missing():
    assert year_proximity(None, 2020) is None
    assert year_proximity(2020, None) is None
    assert year_proximity(None, None) is None


def test_artist_corelease_member_returns_one():
    seed_collabs = {"ancientmethods", "regis"}
    assert artist_corelease(seed_collabs, "ancientmethods") == 1


def test_artist_corelease_non_member_returns_zero():
    seed_collabs = {"ancientmethods", "regis"}
    assert artist_corelease(seed_collabs, "amelielens") == 0


def test_artist_corelease_returns_none_when_not_cached():
    # Distinct from "checked, no collaborators" — that case is `set()` / 0.
    assert artist_corelease(None, "amelielens") is None


def test_artist_corelease_empty_set_returns_zero():
    # We've checked the seed and confirmed it has no collaborators; every
    # candidate naturally returns 0, not None.
    assert artist_corelease(set(), "anyone") == 0


def test_derive_collaborators_happy_path():
    discography = [
        {"releaseId": "r1"},
        {"releaseId": "r2"},
        {"releaseId": "r3"},
    ]
    credits = {
        "r1": ["Oscar Mulero", "Ancient Methods"],
        "r2": ["Oscar Mulero", "Regis"],
        "r3": ["Oscar Mulero"],
    }
    out = derive_collaborators("Oscar Mulero", discography, credits)
    assert out == {"ancientmethods", "regis"}


def test_derive_collaborators_filters_self_credits():
    discography = [{"releaseId": "r1"}]
    # Same person credited under both forms — both should be filtered.
    credits = {"r1": ["Oscar Mulero", "Óscar Mulero"]}
    out = derive_collaborators("Oscar Mulero", discography, credits)
    assert out == set()


def test_derive_collaborators_normalizes_diacritics():
    discography = [{"releaseId": "r1"}]
    credits = {"r1": ["Óscar Mulero"]}
    # Seed is a different artist; "Óscar Mulero" should appear as the
    # diacritic-stripped form, matching the cache-key normalization.
    out = derive_collaborators("Regis", discography, credits)
    assert out == {"oscarmulero"}


def test_derive_collaborators_skips_releases_with_no_credits():
    discography = [{"releaseId": "r1"}, {"releaseId": "r2"}]
    credits = {"r1": ["Regis"]}  # r2 missing entirely
    out = derive_collaborators("Oscar Mulero", discography, credits)
    assert out == {"regis"}


def test_normalize_artist_strips_diacritics_and_punctuation():
    assert normalize_artist("Óscar Mulero") == "oscarmulero"
    assert normalize_artist("Étienne de Crécy") == "etiennedecrecy"
    assert normalize_artist("DJ-Stingray!") == "djstingray"
