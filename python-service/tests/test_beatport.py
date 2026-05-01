"""Tests for Beatport adapter: Camelot mapping and track parsing."""
from unittest.mock import AsyncMock, patch

import pytest
from app.adapters.beatport import BeatportAdapter, _parse_track, _to_camelot
from app.core.models import TrackMeta


# ── _to_camelot ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("key_name,expected", [
    ("A Minor", "8A"),
    ("A Major", "11B"),
    ("C Minor", "5A"),
    ("C Major", "8B"),
    ("F# Minor", "11A"),
    ("Bb Major", "6B"),
    # Enharmonic aliases
    ("C# Minor", "12A"),
    ("A# Minor", "3A"),
])
def test_to_camelot_known_keys(key_name, expected):
    assert _to_camelot(key_name) == expected


def test_to_camelot_none_input():
    assert _to_camelot(None) is None


def test_to_camelot_unknown_key():
    assert _to_camelot("H Major") is None


def test_to_camelot_strips_whitespace():
    assert _to_camelot("  A Minor  ") == "8A"


# ── _parse_track ──────────────────────────────────────────────────────────────

def _raw_track(**overrides) -> dict:
    base = {
        "track_id": 12345678,
        "track_name": "Collapse",
        "mix_name": "Original Mix",
        "artists": [{"artist_name": "Oscar Mulero"}],
        "bpm": 140,
        "key_name": "A Minor",
        "release": {"release_image_uri": "https://example.com/cover.jpg"},
        "genre": [{"genre_name": "Techno"}],
        "label": {"label_name": "Warm Up Recordings"},
    }
    return base | overrides


def test_parse_track_basic():
    result = _parse_track(_raw_track())
    assert result is not None
    assert result.title == "Collapse"
    assert result.artist == "Oscar Mulero"
    assert result.bpm == 140
    assert result.key == "8A"
    assert result.genre == "Techno"
    assert result.label == "Warm Up Recordings"
    assert result.source == "beatport"


def test_parse_track_omits_original_mix_from_title():
    result = _parse_track(_raw_track(mix_name="Original Mix"))
    assert result is not None
    assert result.title == "Collapse"


def test_parse_track_includes_non_original_mix():
    result = _parse_track(_raw_track(mix_name="Dub Mix"))
    assert result is not None
    assert result.title == "Collapse (Dub Mix)"


def test_parse_track_multiple_artists():
    raw = _raw_track(artists=[
        {"artist_name": "Oscar Mulero"},
        {"artist_name": "Ancient Methods"},
    ])
    result = _parse_track(raw)
    assert result is not None
    assert "Oscar Mulero" in result.artist
    assert "Ancient Methods" in result.artist


def test_parse_track_missing_id_returns_none():
    result = _parse_track(_raw_track(track_id=None))
    assert result is None


def test_parse_track_missing_name_returns_none():
    result = _parse_track(_raw_track(track_name=None))
    assert result is None


def test_parse_track_source_url_format():
    result = _parse_track(_raw_track())
    assert result is not None
    assert "beatport.com/track" in result.sourceUrl
    assert "12345678" in result.sourceUrl


# ── enrich_tracks: gap-fill semantics ─────────────────────────────────────────

async def test_enrich_does_not_overwrite_existing_bpm():
    """Beatport enrichment must preserve cosine-derived BPM."""
    adapter = BeatportAdapter()
    track = TrackMeta(
        title="Test", artist="Test", source="cosine_club",
        sourceUrl="https://x/1",
        bpm=137.5,
        key=None,
    )
    with patch.object(adapter, "_fetch_bpm_key",
                      new_callable=AsyncMock,
                      return_value=(140.0, "8A")):
        result = await adapter.enrich_tracks([track])
    enriched = result["https://x/1"]
    assert enriched.bpm == 137.5
    assert enriched.key == "8A"


async def test_enrich_skips_already_complete_tracks():
    """If a track has both bpm and key, no Beatport call is made."""
    adapter = BeatportAdapter()
    track = TrackMeta(
        title="Test", artist="Test", source="cosine_club",
        sourceUrl="https://x/3",
        bpm=140.0,
        key="8A",
    )
    fetch_mock = AsyncMock(return_value=(150.0, "9A"))
    with patch.object(adapter, "_fetch_bpm_key", new=fetch_mock):
        result = await adapter.enrich_tracks([track])
    fetch_mock.assert_not_called()
    enriched = result["https://x/3"]
    assert enriched.bpm == 140.0
    assert enriched.key == "8A"


async def test_enrich_does_not_overwrite_existing_key():
    """Symmetric: existing key is preserved, BPM gap filled."""
    adapter = BeatportAdapter()
    track = TrackMeta(
        title="Test", artist="Test", source="cosine_club",
        sourceUrl="https://x/2",
        bpm=None,
        key="9A",
    )
    with patch.object(adapter, "_fetch_bpm_key",
                      new_callable=AsyncMock,
                      return_value=(140.0, "8A")):
        result = await adapter.enrich_tracks([track])
    enriched = result["https://x/2"]
    assert enriched.bpm == 140.0
    assert enriched.key == "9A"
