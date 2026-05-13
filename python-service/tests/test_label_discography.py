"""Tests for the label-discography orchestrator. Adapters are fully mocked."""
from unittest.mock import AsyncMock

import pytest

from app.services import label_discography as svc
from app.services.label_discography import (
    _normalize_for_match,
    _pick_bandcamp_label_match,
    get_label_releases_combined,
)


def test_normalize_for_match_punctuation_equivalence():
    assert _normalize_for_match("Nebula E.P") == _normalize_for_match("Nebula EP")
    assert _normalize_for_match("Origin E.P.") == _normalize_for_match("Origin EP")
    # NFKD strips combining marks (é → e), not script-distinct letters (ø stays ø).
    assert _normalize_for_match("Café") == _normalize_for_match("Cafe")
    assert _normalize_for_match("") == ""


def test_pick_bandcamp_label_match_exact_only():
    matches = [
        {"name": "Some Other Label", "url": "https://other.bandcamp.com"},
        {"name": "Another Psyde Records", "url": "https://anotherpsyderecords.bandcamp.com"},
        {"name": "Another Psyde", "url": "https://another.bandcamp.com"},
    ]
    picked = _pick_bandcamp_label_match("Another Psyde Records", matches)
    assert picked is not None
    assert picked["url"] == "https://anotherpsyderecords.bandcamp.com"


def test_pick_bandcamp_label_match_returns_none_on_no_exact():
    matches = [{"name": "Almost Right Label", "url": "https://x"}]
    assert _pick_bandcamp_label_match("Right Label", matches) is None


def _mock_discogs(releases: list[dict]) -> AsyncMock:
    d = AsyncMock()
    d.get_label_releases = AsyncMock(return_value={
        "releases": releases,
        "pagination": {"page": 1, "pages": 1, "per_page": 10000, "items": len(releases)},
    })
    return d


def _mock_bandcamp(*, search=None, disco=None, meta=None) -> AsyncMock:
    b = AsyncMock()
    b.search_label = AsyncMock(return_value=search or [])
    b.get_label_discography = AsyncMock(return_value=disco or [])
    b.get_release_meta = AsyncMock(return_value=meta)
    return b


# ── orchestrator behavior ───────────────────────────────────────────────────


async def test_skips_bandcamp_when_discogs_is_fresh(monkeypatch):
    monkeypatch.setattr("app.services.label_discography.datetime",
                        _frozen_datetime(2026))
    discogs = _mock_discogs([{"id": 1, "title": "Hot EP", "year": 2026}])
    bandcamp = _mock_bandcamp()

    out = await get_label_releases_combined(
        discogs=discogs, bandcamp=bandcamp,
        label_id=1, label_name="X", page=1, per_page=20,
    )
    bandcamp.search_label.assert_not_called()
    assert len(out["releases"]) == 1
    assert out["releases"][0]["source"] == "discogs"


async def test_skips_bandcamp_when_no_exact_label_match(monkeypatch):
    monkeypatch.setattr("app.services.label_discography.datetime",
                        _frozen_datetime(2026))
    discogs = _mock_discogs([{"id": 1, "title": "Old EP", "year": 2020}])
    bandcamp = _mock_bandcamp(search=[
        {"name": "Different Label", "url": "https://x.bandcamp.com"},
    ])

    out = await get_label_releases_combined(
        discogs=discogs, bandcamp=bandcamp,
        label_id=1, label_name="Target Label", page=1, per_page=20,
    )
    bandcamp.get_label_discography.assert_not_called()
    assert len(out["releases"]) == 1


async def test_skips_bandcamp_when_label_name_empty(monkeypatch):
    monkeypatch.setattr("app.services.label_discography.datetime",
                        _frozen_datetime(2026))
    discogs = _mock_discogs([{"id": 1, "title": "Old EP", "year": 2020}])
    bandcamp = _mock_bandcamp()

    out = await get_label_releases_combined(
        discogs=discogs, bandcamp=bandcamp,
        label_id=1, label_name="", page=1, per_page=20,
    )
    bandcamp.search_label.assert_not_called()
    assert len(out["releases"]) == 1


async def test_bandcamp_releases_filtered_by_title_already_in_discogs(monkeypatch):
    monkeypatch.setattr("app.services.label_discography.datetime",
                        _frozen_datetime(2026))
    discogs = _mock_discogs([
        {"id": 1, "title": "Nebula EP", "year": 2020, "artist": "Algia"},
    ])
    bandcamp = _mock_bandcamp(
        search=[{"name": "Target", "url": "https://target.bandcamp.com"}],
        disco=[
            {"id": 100, "title": "Nebula E.P", "artist": "Algia",
             "page_url": "/album/nebula", "art_id": 1,
             "absolute_url": "https://target.bandcamp.com/album/nebula",
             "type": "album"},
            {"id": 200, "title": "Fresh Drop", "artist": "Algia",
             "page_url": "/album/fresh", "art_id": 2,
             "absolute_url": "https://target.bandcamp.com/album/fresh",
             "type": "album"},
        ],
    )
    bandcamp.get_release_meta = AsyncMock(side_effect=lambda url: {
        "title": "Fresh Drop", "artist": "Algia", "release_date": "2026-04-01",
        "year": 2026, "art_id": 2, "tracklist": [],
    })

    out = await get_label_releases_combined(
        discogs=discogs, bandcamp=bandcamp,
        label_id=1, label_name="Target", page=1, per_page=20,
    )
    titles = [r["title"] for r in out["releases"]]
    sources = [r["source"] for r in out["releases"]]
    # "Nebula" only once (Discogs version kept). "Fresh Drop" added from Bandcamp.
    assert titles.count("Nebula EP") + titles.count("Nebula E.P") == 1
    assert "Fresh Drop" in titles
    assert sources.count("bandcamp") == 1
    assert sources.count("discogs") == 1
    # Fresh Drop got exactly one meta fetch — the deduped Nebula did not.
    assert bandcamp.get_release_meta.call_count == 1


async def test_caps_bandcamp_meta_fetches(monkeypatch):
    monkeypatch.setattr("app.services.label_discography.datetime",
                        _frozen_datetime(2026))
    monkeypatch.setattr(svc, "_MAX_BANDCAMP_FETCHES", 3)
    discogs = _mock_discogs([{"id": 1, "title": "Old", "year": 2020}])
    bandcamp = _mock_bandcamp(
        search=[{"name": "Target", "url": "https://target.bandcamp.com"}],
        disco=[
            {"id": 100 + i, "title": f"Track {i}", "artist": "A",
             "page_url": f"/album/{i}", "art_id": i,
             "absolute_url": f"https://target.bandcamp.com/album/{i}",
             "type": "album"}
            for i in range(10)
        ],
    )
    bandcamp.get_release_meta = AsyncMock(return_value={
        "title": "Fetched", "artist": "A", "release_date": "2026-01-01",
        "year": 2026, "art_id": 1, "tracklist": [],
    })

    await get_label_releases_combined(
        discogs=discogs, bandcamp=bandcamp,
        label_id=1, label_name="Target", page=1, per_page=20,
    )
    assert bandcamp.get_release_meta.call_count == 3


async def test_merges_sorted_by_year_desc(monkeypatch):
    monkeypatch.setattr("app.services.label_discography.datetime",
                        _frozen_datetime(2026))
    discogs = _mock_discogs([
        {"id": 1, "title": "Mid Discogs", "year": 2022},
        {"id": 2, "title": "Old Discogs", "year": 2018},
    ])
    bandcamp = _mock_bandcamp(
        search=[{"name": "Target", "url": "https://target.bandcamp.com"}],
        disco=[{"id": 99, "title": "Bandcamp Fresh", "artist": "A",
                "page_url": "/album/fresh", "art_id": 1,
                "absolute_url": "https://target.bandcamp.com/album/fresh",
                "type": "album"}],
    )
    bandcamp.get_release_meta = AsyncMock(return_value={
        "title": "Bandcamp Fresh", "artist": "A", "release_date": "2026-01-01",
        "year": 2026, "art_id": 1, "tracklist": [],
    })

    out = await get_label_releases_combined(
        discogs=discogs, bandcamp=bandcamp,
        label_id=1, label_name="Target", page=1, per_page=20,
    )
    years = [r["year"] for r in out["releases"]]
    assert years == [2026, 2022, 2018]


async def test_paginates_combined(monkeypatch):
    monkeypatch.setattr("app.services.label_discography.datetime",
                        _frozen_datetime(2026))
    discogs = _mock_discogs([
        {"id": i, "title": f"Discogs {i}", "year": 2026 - i} for i in range(10)
    ])
    bandcamp = _mock_bandcamp()

    out = await get_label_releases_combined(
        discogs=discogs, bandcamp=bandcamp,
        label_id=1, label_name="X", page=2, per_page=4,
    )
    assert out["pagination"]["items"] == 10
    assert out["pagination"]["pages"] == 3
    assert out["pagination"]["page"] == 2
    assert len(out["releases"]) == 4
    assert out["releases"][0]["title"] == "Discogs 4"


# ── frozen-clock helper (avoids drift across years) ─────────────────────────


def _frozen_datetime(year: int):
    """Patch datetime.now() to return a fixed year. Other attrs delegate."""
    from datetime import datetime as _dt, timezone as _tz

    class _Fake:
        @staticmethod
        def now(tz=None):
            return _dt(year, 6, 15, tzinfo=tz or _tz.utc)
    return _Fake
