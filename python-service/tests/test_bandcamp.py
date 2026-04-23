"""Tests for Bandcamp adapter: HTML unescaping and recommendation parsing."""
import pytest
from unittest.mock import AsyncMock
from app.adapters.bandcamp import _unescape, BandcampAdapter


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
