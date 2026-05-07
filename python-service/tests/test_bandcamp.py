"""Tests for Bandcamp adapter: search JSON API + recommendation HTML parsing
+ per-album first-track resolution.

The adapter holds a single httpx.AsyncClient as `self._client`. Tests patch
`self._client.post` (search API) and `self._client.get` (HTML pages).

Anti-bot signal: every fetch / parse failure logs with the `[Bandcamp]` prefix.
The "source died" canaries in this file assert on those log lines so a CI run
will surface the issue rather than letting a silently-empty result pass.
"""
import json
from unittest.mock import AsyncMock

import httpx

from app.adapters.bandcamp import BandcampAdapter, _AlbumRef


def _make_mock_resp(text: str = "", json_data=None) -> AsyncMock:
    mock_resp = AsyncMock()
    mock_resp.text = text
    mock_resp.raise_for_status = lambda: None
    if json_data is not None:
        mock_resp.json = lambda: json_data
    return mock_resp


def _tralbum_html(trackinfo: list[dict]) -> str:
    """Build an album-page fixture with a `data-tralbum` JSON blob.

    Bandcamp emits the JSON HTML-entity-encoded inside the attribute (i.e.
    inner `"` → `&quot;`), so we mirror that here.
    """
    payload = json.dumps({"trackinfo": trackinfo})
    encoded = payload.replace('"', "&quot;")
    return f'<html><body><div data-tralbum="{encoded}"></div></body></html>'


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


async def test_search_track_returns_first_track_url():
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(return_value=_make_mock_resp(json_data=SEARCH_RESPONSE_WITH_TRACK))

    result = await adapter._search_track("Oscar Mulero Collapse")
    assert result == "https://oscarmulero.bandcamp.com/track/collapse"


async def test_search_track_skips_non_track_types():
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(return_value=_make_mock_resp(json_data=SEARCH_RESPONSE_NO_TRACK))

    assert await adapter._search_track("xyz") is None


async def test_search_track_returns_none_when_results_empty():
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(return_value=_make_mock_resp(json_data=SEARCH_RESPONSE_EMPTY))

    assert await adapter._search_track("xyznotfound123") is None


# ── BandcampAdapter._get_album_refs ───────────────────────────────────────────

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


async def test_get_album_refs_parses_lis():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_WITH_RECS))

    refs = await adapter._get_album_refs(
        "https://oscarmulero.bandcamp.com/track/horses", limit=7
    )

    assert len(refs) == 2
    first = refs[0]
    assert first.album_id == "867591106"
    assert first.album_title == "Deep Blue: Volume 2"
    assert first.artist == "Luigi Tozzi"
    # tracking ?from=... is stripped for stable dedup
    assert first.album_url == "https://hypnus.bandcamp.com/album/deep-blue-volume-2"
    assert first.cover_url == "https://f4.bcbits.com/img/a4213702154_1x1_120.jpg"


async def test_get_album_refs_unescapes_html_entities():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_WITH_RECS))

    refs = await adapter._get_album_refs("https://x.bandcamp.com/track/y", limit=7)
    second = refs[1]
    assert second.album_title == "Hutton & Smith"
    assert second.artist == "Some & Artist"


async def test_get_album_refs_respects_limit():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_WITH_RECS))

    refs = await adapter._get_album_refs("https://x.bandcamp.com/track/y", limit=1)
    assert len(refs) == 1


async def test_get_album_refs_returns_empty_when_no_recs_block():
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_NO_RECS))

    refs = await adapter._get_album_refs("https://x.bandcamp.com/track/y", limit=7)
    assert refs == []


async def test_get_album_refs_detects_track_page_challenge(capsys):
    """Anti-bot canary: when Imperva serves the challenge page on the seed
    track URL, return [] and log a `[Bandcamp]` line so the dead source is
    visible in observability."""
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_CHALLENGE))

    refs = await adapter._get_album_refs("https://x.bandcamp.com/track/y", limit=7)
    assert refs == []
    out = capsys.readouterr().out
    assert "[Bandcamp]" in out
    assert "track page challenged" in out


# ── BandcampAdapter._resolve_first_track ──────────────────────────────────────

_REF = _AlbumRef(
    album_id="867591106",
    album_title="Deep Blue: Volume 2",
    artist="Luigi Tozzi",
    album_url="https://hypnus.bandcamp.com/album/deep-blue-volume-2",
    cover_url="https://f4.bcbits.com/img/a4213702154_1x1_120.jpg",
)


async def test_resolve_first_track_extracts_track_metadata():
    """Happy path: album page has a `data-tralbum` JSON with `trackinfo`,
    and we return the first entry as a real-track TrackMeta."""
    adapter = BandcampAdapter()
    page = _tralbum_html([
        {"id": 111, "track_id": 111, "title": "Glass Tides", "title_link": "/track/glass-tides"},
        {"id": 222, "track_id": 222, "title": "Second Track", "title_link": "/track/second"},
    ])
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=page))

    track = await adapter._resolve_first_track(_REF)

    assert track is not None
    assert track.title == "Glass Tides"
    assert track.artist == "Luigi Tozzi"
    assert track.source == "bandcamp"
    # title_link resolved against album host
    assert track.sourceUrl == "https://hypnus.bandcamp.com/track/glass-tides"
    # Track-scoped EmbeddedPlayer URL (not album=...)
    assert track.embedUrl is not None
    assert "track=111" in track.embedUrl
    assert "album=" not in track.embedUrl
    # cover propagates from the album-ref
    assert track.coverUrl == _REF.cover_url


async def test_resolve_first_track_falls_back_to_album_url_when_title_link_missing():
    adapter = BandcampAdapter()
    page = _tralbum_html([{"id": 111, "track_id": 111, "title": "Just A Title"}])
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=page))

    track = await adapter._resolve_first_track(_REF)
    assert track is not None
    assert track.sourceUrl == _REF.album_url


async def test_resolve_first_track_returns_none_when_album_page_challenged(capsys):
    """Anti-bot canary: per-album challenge logs and returns None so the rec
    is dropped from the result list."""
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=TRACK_PAGE_CHALLENGE))

    track = await adapter._resolve_first_track(_REF)
    assert track is None
    out = capsys.readouterr().out
    assert "[Bandcamp]" in out
    assert "album page challenged" in out


async def test_resolve_first_track_returns_none_when_no_tralbum_blob(capsys):
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text="<html>no blob</html>"))

    track = await adapter._resolve_first_track(_REF)
    assert track is None
    assert "no data-tralbum" in capsys.readouterr().out


async def test_resolve_first_track_returns_none_when_trackinfo_empty(capsys):
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(return_value=_make_mock_resp(text=_tralbum_html([])))

    track = await adapter._resolve_first_track(_REF)
    assert track is None
    assert "empty trackinfo" in capsys.readouterr().out


async def test_resolve_first_track_returns_none_on_http_error(capsys):
    adapter = BandcampAdapter()
    adapter._client.get = AsyncMock(side_effect=httpx.ConnectError("dns fail"))

    track = await adapter._resolve_first_track(_REF)
    assert track is None
    out = capsys.readouterr().out
    assert "[Bandcamp]" in out
    assert "album page error" in out


# ── BandcampAdapter.find_similar (end-to-end with mocked HTTP) ────────────────


def _dispatch_get(adapter: BandcampAdapter, mapping: dict[str, str]):
    """Patch adapter._client.get to return per-URL HTML based on `mapping`.

    Any URL not in the mapping raises AssertionError so unintended fetches are
    loud in test output.
    """
    async def _get(url, **_kwargs):
        if url not in mapping:
            raise AssertionError(f"unexpected GET: {url}")
        return _make_mock_resp(text=mapping[url])
    adapter._client.get = AsyncMock(side_effect=_get)


async def test_find_similar_returns_first_track_per_album_in_parallel():
    """End-to-end: search → seed page → 2 album-ref → 2 album pages, each
    contributing one track to the final result."""
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(return_value=_make_mock_resp(json_data=SEARCH_RESPONSE_WITH_TRACK))

    seed_url = "https://oscarmulero.bandcamp.com/track/collapse"
    album_a = "https://hypnus.bandcamp.com/album/deep-blue-volume-2"
    album_b = "https://other.bandcamp.com/album/hutton-smith"

    _dispatch_get(adapter, {
        seed_url: TRACK_PAGE_WITH_RECS,
        album_a: _tralbum_html([
            {"id": 111, "track_id": 111, "title": "Glass Tides", "title_link": "/track/glass-tides"},
        ]),
        album_b: _tralbum_html([
            {"id": 222, "track_id": 222, "title": "Hutton Opener", "title_link": "/track/hutton-opener"},
        ]),
    })

    results = await adapter.find_similar("Oscar Mulero Collapse", limit=7)

    assert len(results) == 2
    titles = {t.title for t in results}
    assert titles == {"Glass Tides", "Hutton Opener"}
    # Each result is a real track URL (not the album URL) and a track-scoped embed.
    for t in results:
        assert "/track/" in t.sourceUrl
        assert t.embedUrl is not None and "track=" in t.embedUrl


async def test_find_similar_skips_challenged_album_but_keeps_others(capsys):
    """One album challenged → that rec dropped, the other survives."""
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(return_value=_make_mock_resp(json_data=SEARCH_RESPONSE_WITH_TRACK))

    seed_url = "https://oscarmulero.bandcamp.com/track/collapse"
    album_a = "https://hypnus.bandcamp.com/album/deep-blue-volume-2"
    album_b = "https://other.bandcamp.com/album/hutton-smith"

    _dispatch_get(adapter, {
        seed_url: TRACK_PAGE_WITH_RECS,
        album_a: _tralbum_html([
            {"id": 111, "track_id": 111, "title": "Glass Tides", "title_link": "/track/glass-tides"},
        ]),
        album_b: TRACK_PAGE_CHALLENGE,
    })

    results = await adapter.find_similar("Oscar Mulero Collapse", limit=7)
    assert len(results) == 1
    assert results[0].title == "Glass Tides"
    out = capsys.readouterr().out
    # Per-album challenge logged with the standard prefix.
    assert "[Bandcamp]" in out
    assert "album page challenged" in out
    # Not the "all failed" log — at least one rec survived.
    assert "all album fetches failed" not in out


async def test_find_similar_logs_when_all_albums_challenged(capsys):
    """Anti-bot canary: every album-page fetch is challenged → empty list +
    a `[Bandcamp] all album fetches failed` log so the dead source is loud."""
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(return_value=_make_mock_resp(json_data=SEARCH_RESPONSE_WITH_TRACK))

    seed_url = "https://oscarmulero.bandcamp.com/track/collapse"
    album_a = "https://hypnus.bandcamp.com/album/deep-blue-volume-2"
    album_b = "https://other.bandcamp.com/album/hutton-smith"

    _dispatch_get(adapter, {
        seed_url: TRACK_PAGE_WITH_RECS,
        album_a: TRACK_PAGE_CHALLENGE,
        album_b: TRACK_PAGE_CHALLENGE,
    })

    results = await adapter.find_similar("Oscar Mulero Collapse", limit=7)
    assert results == []
    out = capsys.readouterr().out
    assert "[Bandcamp] all album fetches failed" in out


async def test_find_similar_returns_empty_when_seed_search_fails(capsys):
    """If the search API fails, no album fetches happen and we return []."""
    adapter = BandcampAdapter()
    adapter._client.post = AsyncMock(side_effect=httpx.ConnectError("dns fail"))
    adapter._client.get = AsyncMock(side_effect=AssertionError("must not GET"))

    results = await adapter.find_similar("anything")
    assert results == []
    assert "[Bandcamp] search api error" in capsys.readouterr().out
