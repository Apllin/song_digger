"""Tests for BandcampAdapter — mocks httpx client, never hits the network."""
from unittest.mock import AsyncMock

import pytest

from app.adapters import bandcamp as bandcamp_module
from app.adapters.bandcamp import (
    BandcampAdapter,
    _format_duration,
    _parse_release_year,
    _rfc2822_to_iso_date,
)


def _resp(*, json_data=None, text=None, status_code: int = 200) -> AsyncMock:
    r = AsyncMock()
    r.status_code = status_code
    r.json = lambda: json_data
    r.text = text or ""
    r.raise_for_status = lambda: None
    return r


@pytest.fixture
def adapter(monkeypatch) -> BandcampAdapter:
    # Disable all cache reads/writes for the adapter under test.
    monkeypatch.setattr(bandcamp_module, "fetch_external_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(bandcamp_module, "upsert_external_cache", AsyncMock(return_value=None))
    return BandcampAdapter()


# ── helpers ─────────────────────────────────────────────────────────────────


def test_format_duration():
    assert _format_duration(None) == ""
    assert _format_duration(0) == ""
    assert _format_duration(-5) == ""
    assert _format_duration(59.4) == "0:59"
    assert _format_duration(60) == "1:00"
    assert _format_duration(444.179) == "7:24"


def test_parse_release_year():
    assert _parse_release_year(None) is None
    assert _parse_release_year("") is None
    assert _parse_release_year("garbage") is None
    assert _parse_release_year("02 May 2026 00:00:00 GMT") == 2026
    assert _parse_release_year("18 Jul 2022 00:00:00 GMT") == 2022


def test_rfc2822_to_iso_date():
    assert _rfc2822_to_iso_date(None) == ""
    assert _rfc2822_to_iso_date("02 May 2026 00:00:00 GMT") == "2026-05-02"


# ── search_label ────────────────────────────────────────────────────────────


async def test_search_label_empty_query(adapter):
    assert await adapter.search_label("") == []
    assert await adapter.search_label("   ") == []


async def test_search_label_maps_only_type_b(adapter):
    adapter._client.post = AsyncMock(return_value=_resp(json_data={
        "auto": {"results": [
            {"type": "b", "id": 1, "name": "Real Label",
             "item_url_root": "https://reallabel.bandcamp.com", "img": "http://img/1.jpg"},
            {"type": "t", "id": 2, "name": "Some Track",
             "item_url_path": "/track/x"},  # filtered out — not type b
            {"type": "b", "id": 3, "name": "No URL"},  # filtered out — no url
        ]}
    }))
    out = await adapter.search_label("anything")
    assert len(out) == 1
    assert out[0] == {
        "id": 1, "name": "Real Label",
        "url": "https://reallabel.bandcamp.com", "image": "http://img/1.jpg",
    }


async def test_search_label_soft_degrades_on_exception(adapter):
    adapter._client.post = AsyncMock(side_effect=RuntimeError("boom"))
    assert await adapter.search_label("anything") == []


# ── get_label_discography ───────────────────────────────────────────────────


_MUSIC_HTML_GRID_AND_JSON = """
<html><body>
<ol class="music-grid" data-client-items="[{&quot;id&quot;:777,&quot;art_id&quot;:88,&quot;artist&quot;:&quot;OldArtist&quot;,&quot;page_url&quot;:&quot;/album/old&quot;,&quot;title&quot;:&quot;Old EP&quot;,&quot;type&quot;:&quot;album&quot;}]">
  <li data-item-id="album-111" data-band-id="9" class="music-grid-item">
    <a href="/album/new-one">
      <div class="art"><img src="https://f4.bcbits.com/img/a99_2.jpg" /></div>
      <p class="title">
        New One
        <br><span class="artist-override">NewArtist</span>
      </p>
    </a>
  </li>
</ol>
</body></html>
"""


async def test_get_label_discography_unions_grid_and_json(adapter):
    adapter._client.get = AsyncMock(return_value=_resp(text=_MUSIC_HTML_GRID_AND_JSON))
    out = await adapter.get_label_discography("https://x.bandcamp.com")
    ids = {it["id"] for it in out}
    assert ids == {111, 777}
    grid_item = next(it for it in out if it["id"] == 111)
    assert grid_item["title"] == "New One"
    assert grid_item["artist"] == "NewArtist"
    assert grid_item["page_url"] == "/album/new-one"
    assert grid_item["art_id"] == 99
    assert grid_item["absolute_url"] == "https://x.bandcamp.com/album/new-one"
    json_item = next(it for it in out if it["id"] == 777)
    assert json_item["title"] == "Old EP"
    assert json_item["artist"] == "OldArtist"


async def test_get_label_discography_soft_degrades_on_imperva(adapter):
    html = "<!-- _Incapsula_Resource fail -->" + "x" * 500
    adapter._client.get = AsyncMock(return_value=_resp(text=html))
    assert await adapter.get_label_discography("https://x.bandcamp.com") == []


async def test_get_label_discography_soft_degrades_on_http_error(adapter):
    adapter._client.get = AsyncMock(side_effect=RuntimeError("503"))
    assert await adapter.get_label_discography("https://x.bandcamp.com") == []


async def test_get_label_discography_unescapes_entities(adapter):
    html = """
    <ol class="music-grid">
      <li data-item-id="album-1" class="music-grid-item">
        <a href="/album/x">
          <p class="title">A &amp; B
            <br><span class="artist-override">Foo &amp; Bar</span>
          </p>
        </a>
      </li>
    </ol>
    """
    adapter._client.get = AsyncMock(return_value=_resp(text=html))
    out = await adapter.get_label_discography("https://x.bandcamp.com")
    assert out[0]["title"] == "A & B"
    assert out[0]["artist"] == "Foo & Bar"


# ── get_release_meta ────────────────────────────────────────────────────────


_ALBUM_HTML = """
<html><body>
<div data-tralbum="{&quot;current&quot;:{&quot;title&quot;:&quot;My EP&quot;,&quot;release_date&quot;:&quot;02 May 2026 00:00:00 GMT&quot;},&quot;artist&quot;:&quot;Algia&quot;,&quot;art_id&quot;:7777,&quot;trackinfo&quot;:[{&quot;title&quot;:&quot;Track A&quot;,&quot;track_num&quot;:1,&quot;duration&quot;:120.5},{&quot;title&quot;:&quot;Track B&quot;,&quot;track_num&quot;:2,&quot;duration&quot;:240,&quot;artist&quot;:&quot;Guest&quot;}]}">
</div>
</body></html>
"""


async def test_get_release_meta_parses_full_payload(adapter):
    adapter._client.get = AsyncMock(return_value=_resp(text=_ALBUM_HTML))
    meta = await adapter.get_release_meta("https://x.bandcamp.com/album/my-ep")
    assert meta is not None
    assert meta["title"] == "My EP"
    assert meta["artist"] == "Algia"
    assert meta["year"] == 2026
    assert meta["release_date"] == "2026-05-02"
    assert meta["art_id"] == 7777
    assert len(meta["tracklist"]) == 2
    assert meta["tracklist"][0] == {
        "position": "1", "title": "Track A", "duration": "2:00", "artists": ["Algia"],
    }
    # Track-level artist override survives
    assert meta["tracklist"][1]["artists"] == ["Guest"]


async def test_get_release_meta_returns_none_on_missing_blob(adapter):
    adapter._client.get = AsyncMock(return_value=_resp(text="<html>no tralbum</html>"))
    assert await adapter.get_release_meta("https://x.bandcamp.com/album/y") is None


async def test_get_release_meta_returns_none_on_imperva(adapter):
    adapter._client.get = AsyncMock(return_value=_resp(
        text='<html>_Incapsula_Resource block</html>' + 'x' * 500
    ))
    assert await adapter.get_release_meta("https://x.bandcamp.com/album/y") is None


async def test_get_release_meta_returns_none_on_http_error(adapter):
    adapter._client.get = AsyncMock(side_effect=RuntimeError("network"))
    assert await adapter.get_release_meta("https://x.bandcamp.com/album/y") is None


# ── cache pathway ───────────────────────────────────────────────────────────


async def test_cache_hit_bypasses_network(adapter, monkeypatch):
    cached = [{"id": 42, "name": "Cached", "url": "https://x", "image": None}]
    monkeypatch.setattr(
        bandcamp_module, "fetch_external_cache", AsyncMock(return_value=cached)
    )
    adapter._client.post = AsyncMock(side_effect=AssertionError("must not call"))
    assert await adapter.search_label("anything") == cached
