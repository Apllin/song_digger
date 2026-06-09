"""Tests for genre bucketing and one-hot encoding."""
import pytest

from app.core.genre_buckets import GENRE_BUCKETS, BPM_RANGES, genre_to_bucket, genre_one_hot, bpm_range_features


@pytest.mark.parametrize("raw,expected_bucket", [
    ("Techno", "techno"),
    ("Hard Techno", "techno"),
    ("Industrial", "techno"),
    ("EBM", "techno"),
    ("House", "house"),
    ("Tech House", "house"),
    ("Deep House", "house"),
    ("Afro House", "house"),
    ("Melodic House & Techno", "house"),
    ("Progressive House", "house"),
    ("Drum & Bass", "drum_bass"),
    ("Jungle", "drum_bass"),
    ("Trance", "trance"),
    ("Psy-Trance", "trance"),
    ("Progressive Trance", "trance"),
    ("Breaks", "breaks"),
    ("Breakbeat", "breaks"),
    ("UK Garage", "breaks"),
    ("Ambient", "ambient"),
    ("Downtempo", "ambient"),
    ("Chillout", "ambient"),
    ("Unknown Genre XYZ", "other"),
    (None, "other"),
])
def test_genre_to_bucket(raw, expected_bucket):
    assert genre_to_bucket(raw) == expected_bucket


def test_genre_one_hot_techno():
    vec = genre_one_hot("techno")
    assert len(vec) == len(GENRE_BUCKETS)
    assert vec[GENRE_BUCKETS.index("techno")] == 1.0
    assert sum(vec) == 1.0


def test_genre_one_hot_other():
    vec = genre_one_hot("other")
    assert vec[GENRE_BUCKETS.index("other")] == 1.0
    assert sum(vec) == 1.0


def test_genre_one_hot_all_buckets_valid():
    for bucket in GENRE_BUCKETS:
        vec = genre_one_hot(bucket)
        assert sum(vec) == 1.0


@pytest.mark.parametrize("bpm,expected_range,expected_present", [
    (80.0, "slow", 1.0),
    (89.9, "slow", 1.0),
    (90.0, "mid", 1.0),
    (119.9, "mid", 1.0),
    (120.0, "fast", 1.0),
    (139.9, "fast", 1.0),
    (140.0, "vfast", 1.0),
    (175.0, "vfast", 1.0),
    (None, None, 0.0),
])
def test_bpm_range_features(bpm, expected_range, expected_present):
    one_hot, present = bpm_range_features(bpm)
    assert len(one_hot) == len(BPM_RANGES)
    assert present == expected_present
    if expected_range is not None:
        assert one_hot[BPM_RANGES.index(expected_range)] == 1.0
        assert sum(one_hot) == 1.0
    else:
        assert sum(one_hot) == 0.0
