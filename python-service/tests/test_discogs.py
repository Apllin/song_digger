"""
Tests for DiscogsAdapter.

Covers search_artist / get_releases — the surface used by the /discography
and /labels pages.

Uses AsyncMock against the adapter's persistent httpx client. Real HTTP is
never made.
"""
from unittest.mock import AsyncMock

import pytest

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
