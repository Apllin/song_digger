"""Tests for Bandcamp adapter: HTML unescaping and recommendation parsing."""
import pytest
from unittest.mock import AsyncMock
from app.adapters.bandcamp import _unescape, BandcampAdapter
from app.core.models import TrackMeta


# ── _unescape ─────────────────────────────────────────────────────────────────

def test_unescape_quotes():
    assert _unescape("&quot;title&quot;") == '"title"'


def test_unescape_ampersand():
    assert _unescape("Artist &amp; Artist") == "Artist & Artist"


def test_unescape_apostrophe():
    assert _unescape("don&#39;t") == "don't"


def test_unescape_angle_brackets():
    assert _unescape("&lt;3 &gt;") == "<3 >"


def test_unescape_no_entities():
    assert _unescape("plain text") == "plain text"


def test_unescape_combined():
    assert _unescape("&quot;Oscar Mulero &amp; Ancient Methods&quot;") == '"Oscar Mulero & Ancient Methods"'


# ── BandcampAdapter._search_track ─────────────────────────────────────────────

SEARCH_HTML_WITH_RESULT = """
<html><body>
<ul class="result-items">
  <li class="searchresult track">
    <div class="result-info">
      <a href="https://oscarmulero.bandcamp.com/track/collapse">Collapse</a>
    </div>
  </li>
</ul>
</body></html>
"""

SEARCH_HTML_NO_RESULT = """
<html><body><ul class="result-items"></ul></body></html>
"""


def _make_mock_resp(html: str) -> AsyncMock:
    mock_resp = AsyncMock()
    mock_resp.text = html
    mock_resp.raise_for_status = lambda: None
    return mock_resp


@pytest.mark.asyncio
async def test_search_track_returns_url():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(SEARCH_HTML_WITH_RESULT))

    result = await adapter._search_track("Oscar Mulero Collapse")
    assert result == "https://oscarmulero.bandcamp.com/track/collapse"


@pytest.mark.asyncio
async def test_search_track_returns_none_when_no_results():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(SEARCH_HTML_NO_RESULT))

    result = await adapter._search_track("xyznotfound123")
    assert result is None


# ── BandcampAdapter._get_recommendations (no recommendations block) ───────────

TRACK_PAGE_NO_RECS = """
<html><body>
<script data-tralbum="{&quot;id&quot;: 1111, &quot;type&quot;: &quot;track&quot;}"></script>
</body></html>
"""


@pytest.mark.asyncio
async def test_get_recommendations_returns_empty_when_no_recs_block():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(TRACK_PAGE_NO_RECS))

    result = await adapter._get_recommendations(
        "https://oscarmulero.bandcamp.com/track/collapse", limit=7
    )
    assert result == []


# ── BandcampAdapter._resolve_item: ID-from-JSON fast path ─────────────────────

@pytest.mark.asyncio
async def test_bandcamp_resolve_uses_id_from_json_when_available():
    """When tralbum_id is in the rec item, no page fetch happens."""
    adapter = BandcampAdapter()
    item = {
        "url": "https://artist.bandcamp.com/track/something",
        "title": "Something",
        "artist": "Artist",
        "art_url": "https://f4.bcbits.com/img/a123_10.jpg",
        "tralbum_id": 1234567,
    }
    mock_get = AsyncMock()
    adapter._client.get = mock_get

    result = await adapter._resolve_item(item)

    assert isinstance(result, TrackMeta)
    assert "1234567" in (result.embedUrl or "")
    assert "track=" in (result.embedUrl or "")
    mock_get.assert_not_called()


@pytest.mark.asyncio
async def test_bandcamp_resolve_album_uses_album_id_from_json():
    """For album URLs, build an album=… embed URL from album_id without fetching."""
    adapter = BandcampAdapter()
    item = {
        "url": "https://artist.bandcamp.com/album/some-album",
        "title": "Some Album",
        "artist": "Artist",
        "album_id": 9876543,
    }
    mock_get = AsyncMock()
    adapter._client.get = mock_get

    result = await adapter._resolve_item(item)

    assert isinstance(result, TrackMeta)
    assert "album=9876543" in (result.embedUrl or "")
    mock_get.assert_not_called()


ITEM_PAGE_HTML = """
<html><body>
<script data-tralbum="{&quot;id&quot;: 4242, &quot;artist&quot;: &quot;Artist&quot;, &quot;art_id&quot;: 99}"></script>
</body></html>
"""


@pytest.mark.asyncio
async def test_bandcamp_resolve_falls_back_to_page_when_id_missing():
    """When no ID in JSON, fall back to fetch + parse the item page."""
    adapter = BandcampAdapter()
    item = {
        "url": "https://artist.bandcamp.com/track/something",
        "title": "Something",
        "artist": "Artist",
    }
    mock_get = AsyncMock(return_value=_make_mock_resp(ITEM_PAGE_HTML))
    adapter._client.get = mock_get

    result = await adapter._resolve_item(item)

    assert isinstance(result, TrackMeta)
    assert "track=4242" in (result.embedUrl or "")
    mock_get.assert_called_once()
