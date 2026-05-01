"""Tests for Bandcamp adapter: search JSON API + recommendation HTML parsing."""
import pytest
from unittest.mock import AsyncMock
from app.adapters.bandcamp import BandcampAdapter


def _make_mock_resp(text: str = "", json_data=None) -> AsyncMock:
    mock_resp = AsyncMock()
    mock_resp.text = text
    mock_resp.raise_for_status = lambda: None
    if json_data is not None:
        mock_resp.json = lambda: json_data
    return mock_resp


# ── BandcampAdapter._search_track ─────────────────────────────────────────────

SEARCH_RESPONSE_WITH_TRACK = {
    "auto": {
        "results": [
            {"type": "b", "name": "Some Band"},
            {
                "type": "t",
                "name": "Collapse",
                "band_name": "Oscar Mulero",
                "item_url_path": "https://oscarmulero.bandcamp.com/track/collapse",
            },
        ]
    }
}

SEARCH_RESPONSE_NO_TRACK = {"auto": {"results": [{"type": "b", "name": "Only a band"}]}}
SEARCH_RESPONSE_EMPTY = {"auto": {"results": []}}


@pytest.mark.asyncio
async def test_search_track_returns_first_track_url():
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(return_value=_make_mock_resp(json_data=SEARCH_RESPONSE_WITH_TRACK))

    result = await adapter._search_track("Oscar Mulero Collapse")
    assert result == "https://oscarmulero.bandcamp.com/track/collapse"


@pytest.mark.asyncio
async def test_search_track_skips_non_track_types():
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(return_value=_make_mock_resp(json_data=SEARCH_RESPONSE_NO_TRACK))

    assert await adapter._search_track("xyz") is None


@pytest.mark.asyncio
async def test_search_track_returns_none_when_results_empty():
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(return_value=_make_mock_resp(json_data=SEARCH_RESPONSE_EMPTY))

    assert await adapter._search_track("xyznotfound123") is None


# ── BandcampAdapter._get_recommendations ──────────────────────────────────────

# Mirrors the live page structure: each rec is a <li class="recommended-album"
# ... data-albumid=... data-albumtitle=... data-artist=...> with an inner
# <a class="album-link" href="..."> and <img class="album-art" src="...">.
TRACK_PAGE_WITH_RECS = """
<html><body>
<div id="recommendations_container">
  <li class="recommended-album footer-cc"
      id="id-867591106"
      data-trackid="618680744"
      data-albumtitle="Deep Blue: Volume 2"
      data-albumid="867591106"
      data-artist="Luigi Tozzi">
    <img class="album-art" src="https://f4.bcbits.com/img/a4213702154_1x1_120.jpg">
    <a class="album-link" href="https://hypnus.bandcamp.com/album/deep-blue-volume-2?from=footer-cc-x">link</a>
  </li>
  <li class="recommended-album footer-nn"
      id="id-1506613724"
      data-trackid="3770299338"
      data-albumtitle="Hutton &amp; Smith"
      data-artist="Some &amp; Artist"
      data-albumid="1506613724">
    <img class="album-art" src="https://f4.bcbits.com/img/a999_1x1_120.jpg">
    <a class="album-link" href="https://other.bandcamp.com/album/hutton-smith">link</a>
  </li>
</div>
</body></html>
"""

TRACK_PAGE_NO_RECS = "<html><body><p>nothing here</p></body></html>"

TRACK_PAGE_CHALLENGE = """
<html><head><title>Client Challenge</title></head>
<body><script src="/_fs-ch-XXX/script.js"></script></body></html>
"""


@pytest.mark.asyncio
async def test_get_recommendations_parses_lis():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_WITH_RECS))

    results = await adapter._get_recommendations(
        "https://oscarmulero.bandcamp.com/track/horses", limit=7
    )

    assert len(results) == 2
    first = results[0]
    assert first.title == "Deep Blue: Volume 2"
    assert first.artist == "Luigi Tozzi"
    assert first.source == "bandcamp"
    # tracking ?from=... is stripped for stable dedup
    assert first.sourceUrl == "https://hypnus.bandcamp.com/album/deep-blue-volume-2"
    assert first.coverUrl == "https://f4.bcbits.com/img/a4213702154_1x1_120.jpg"
    assert "album=867591106" in (first.embedUrl or "")


@pytest.mark.asyncio
async def test_get_recommendations_unescapes_html_entities():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_WITH_RECS))

    results = await adapter._get_recommendations("https://x.bandcamp.com/track/y", limit=7)
    second = results[1]
    assert second.title == "Hutton & Smith"
    assert second.artist == "Some & Artist"


@pytest.mark.asyncio
async def test_get_recommendations_respects_limit():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_WITH_RECS))

    results = await adapter._get_recommendations("https://x.bandcamp.com/track/y", limit=1)
    assert len(results) == 1


@pytest.mark.asyncio
async def test_get_recommendations_returns_empty_when_no_recs_block():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_NO_RECS))

    results = await adapter._get_recommendations("https://x.bandcamp.com/track/y", limit=7)
    assert results == []


@pytest.mark.asyncio
async def test_get_recommendations_detects_challenge_page():
    """When Imperva serves the bot-challenge interstitial, return [] and don't try to parse."""
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_CHALLENGE))

    results = await adapter._get_recommendations("https://x.bandcamp.com/track/y", limit=7)
    assert results == []
