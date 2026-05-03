"""
Tests for DiscogsAdapter.

Covers:
- search_artist / get_releases (existing surface used by /labels page)
- fetch_artist_discography / fetch_release_credits (Stage C2)

Uses AsyncMock against the adapter's persistent httpx client (same shape as
test_bandcamp.py). Real HTTP is never made.
"""
from unittest.mock import AsyncMock

import httpx
import pytest

from app.adapters import discogs as discogs_module
from app.adapters.discogs import DiscogsAdapter
from app.config import settings


def _make_resp(json_data: dict, status_code: int = 200) -> AsyncMock:
    """Mock httpx.Response shape used by the adapter's _get helper."""
    resp = AsyncMock()
    resp.status_code = status_code
    resp.json = lambda: json_data
    resp.headers = {}
    resp.raise_for_status = lambda: None
    return resp


@pytest.fixture
def adapter(monkeypatch) -> DiscogsAdapter:
    """A DiscogsAdapter with a guaranteed-non-empty token so no soft-degrade."""
    monkeypatch.setattr(settings, "discogs_token", "test-token")
    return DiscogsAdapter()


# ── search_artist + get_releases ─────────────────────────────────────────────


async def test_search_artist_returns_none_when_token_missing(monkeypatch):
    monkeypatch.setattr(settings, "discogs_token", "")
    adapter = DiscogsAdapter()
    assert await adapter.search_artist("Oscar Mulero") == []


async def test_search_artist_maps_results(adapter):
    adapter._client.get = AsyncMock(return_value=_make_resp({
        "results": [
            {
                "id": 12345,
                "title": "Oscar Mulero",
                "thumb": "http://img/x.jpg",
                "resource_url": "http://api/artists/12345",
            },
            # Result without id is dropped:
            {"id": None, "title": "Garbage"},
        ]
    }))

    out = await adapter.search_artist("Oscar Mulero")
    assert out == [{
        "id": 12345,
        "name": "Oscar Mulero",
        "imageUrl": "http://img/x.jpg",
        "resourceUrl": "http://api/artists/12345",
    }]


# ── fetch_artist_discography ─────────────────────────────────────────────────


async def test_fetch_discography_soft_degrades_without_token(monkeypatch):
    monkeypatch.setattr(settings, "discogs_token", "")
    adapter = DiscogsAdapter()
    assert await adapter.fetch_artist_discography("Oscar Mulero") is None


async def test_fetch_discography_returns_none_for_unknown_artist(adapter):
    # Search returns empty → adapter returns None (no further calls).
    adapter._client.get = AsyncMock(return_value=_make_resp({"results": []}))
    assert await adapter.fetch_artist_discography("nobody-noname") is None


async def test_fetch_discography_happy_path(adapter):
    search_resp = _make_resp({
        "results": [{"id": 11, "title": "Oscar Mulero"}],
    })
    releases_resp = _make_resp({
        "releases": [
            {"id": 1, "year": 2018, "title": "Black Propaganda", "label": "PoleGroup"},
            {"id": 2, "year": 2020, "title": "Damm-Ed", "label": "Token"},
            # Dropped: no year
            {"id": 3, "year": 0, "title": "Demo"},
            # Dropped: no id
            {"id": None, "year": 2021, "title": "Mystery"},
        ],
        "pagination": {"page": 1, "pages": 1},
    })
    adapter._client.get = AsyncMock(side_effect=[search_resp, releases_resp])

    out = await adapter.fetch_artist_discography("Oscar Mulero")
    assert out == [
        {"releaseId": "1", "year": 2018, "title": "Black Propaganda", "label": "PoleGroup"},
        {"releaseId": "2", "year": 2020, "title": "Damm-Ed", "label": "Token"},
    ]


async def test_fetch_discography_caps_at_max_releases(adapter, monkeypatch):
    # Make the cap small for the test so we don't have to fixture 100 entries.
    monkeypatch.setattr(discogs_module, "MAX_DISCOGRAPHY_RELEASES", 2)
    search_resp = _make_resp({"results": [{"id": 11, "title": "X"}]})
    releases_resp = _make_resp({
        "releases": [
            {"id": 1, "year": 2018, "title": "a", "label": "L1"},
            {"id": 2, "year": 2019, "title": "b", "label": "L2"},
            {"id": 3, "year": 2020, "title": "c", "label": "L3"},
        ],
        "pagination": {"page": 1, "pages": 1},
    })
    adapter._client.get = AsyncMock(side_effect=[search_resp, releases_resp])

    out = await adapter.fetch_artist_discography("X")
    assert len(out) == 2


async def test_fetch_discography_soft_degrades_on_releases_error(adapter, capsys):
    search_resp = _make_resp({"results": [{"id": 11, "title": "X"}]})
    adapter._client.get = AsyncMock(side_effect=[
        search_resp,
        httpx.RequestError("boom"),
    ])

    out = await adapter.fetch_artist_discography("X")
    assert out is None
    captured = capsys.readouterr().out
    assert "[Discogs] discography fetch error" in captured


# ── fetch_release_credits ────────────────────────────────────────────────────


async def test_fetch_release_credits_soft_degrades_without_token(monkeypatch):
    monkeypatch.setattr(settings, "discogs_token", "")
    adapter = DiscogsAdapter()
    assert await adapter.fetch_release_credits("123") is None


async def test_fetch_release_credits_collects_all_artist_sources(adapter):
    adapter._client.get = AsyncMock(return_value=_make_resp({
        "artists": [{"name": "Oscar Mulero"}, {"name": "Ancient Methods"}],
        "extraartists": [{"name": "Regis"}],
        "tracklist": [
            {"artists": [{"name": "Oscar Mulero"}]},
            {"artists": [{"name": "Pär Grindvik"}]},
        ],
    }))

    out = await adapter.fetch_release_credits("999")
    # Order is preserved across the three sources; duplicates are kept (the
    # feature module dedupes via set).
    assert out == [
        "Oscar Mulero",
        "Ancient Methods",
        "Regis",
        "Oscar Mulero",
        "Pär Grindvik",
    ]


async def test_fetch_release_credits_returns_none_on_error(adapter, capsys):
    adapter._client.get = AsyncMock(side_effect=httpx.RequestError("boom"))
    out = await adapter.fetch_release_credits("999")
    assert out is None
    assert "[Discogs] release credits error" in capsys.readouterr().out


async def test_fetch_release_credits_handles_missing_credit_lists(adapter):
    # Solo release with no extraartists / tracklist data.
    adapter._client.get = AsyncMock(return_value=_make_resp({
        "artists": [{"name": "Oscar Mulero"}],
    }))
    out = await adapter.fetch_release_credits("999")
    assert out == ["Oscar Mulero"]


async def test_fetch_release_credits_skips_blank_names(adapter):
    adapter._client.get = AsyncMock(return_value=_make_resp({
        "artists": [{"name": ""}, {"name": "  "}, {"name": "Regis"}],
        "extraartists": [],
        "tracklist": [],
    }))
    out = await adapter.fetch_release_credits("999")
    assert out == ["Regis"]
