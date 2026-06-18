"""Unit tests for SoundCloud adapter helpers."""
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

import app.adapters.soundcloud as sc_mod
from app.adapters.soundcloud import (
    SoundCloudAdapter,
    _pick_seed,
    _split_query,
)
from app.core.seed_match import MATCH_EXACT, MATCH_NONE


# ── _split_query ──────────────────────────────────────────────────────────────

def test_split_query_artist_track():
    assert _split_query("Ignez - Lightworker") == ("Ignez", "Lightworker")


def test_split_query_artist_only():
    assert _split_query("Surgeon") == ("Surgeon", None)


def test_split_query_artist_only_multiword():
    assert _split_query("Dani Duran") == ("Dani Duran", None)


def test_split_query_trailing_separator():
    assert _split_query("Ignez - ") == ("Ignez", None)


# ── _fetch_recommended seed exclusion ─────────────────────────────────────────

def _mock_async_client(html: str, monkeypatch):
    resp = MagicMock(spec=httpx.Response)
    resp.raise_for_status = MagicMock(return_value=None)
    resp.text = html

    client = MagicMock()
    client.get = AsyncMock(return_value=resp)

    monkeypatch.setattr("app.adapters.soundcloud.httpx.AsyncClient", lambda **_: client)


async def test_fetch_recommended_excludes_seed_track(monkeypatch):
    # The /recommended page links back to the seed (player widget at the top).
    # Without exclusion, the queried track itself leaks into the results.
    html = """
    <noscript>
      <a href="/rill/onyx-balls-baile">Rill - Onyx Balls Baile</a>
      <a href="/oscar-mulero/horses">Oscar Mulero - Horses</a>
      <a href="/surgeon/vortex">Surgeon - Vortex</a>
    </noscript>
    """
    _mock_async_client(html, monkeypatch)
    adapter = SoundCloudAdapter()
    seed_url = "https://soundcloud.com/rill/onyx-balls-baile"

    results = await adapter._fetch_recommended(seed_url, limit=5)

    urls = [t.sourceUrl for t in results]
    assert seed_url not in urls
    assert urls == [
        "https://soundcloud.com/oscar-mulero/horses",
        "https://soundcloud.com/surgeon/vortex",
    ]


async def test_fetch_recommended_seed_exclusion_ignores_trailing_slash(monkeypatch):
    html = """
    <noscript>
      <a href="/rill/onyx-balls-baile/">Rill - Onyx Balls Baile</a>
      <a href="/surgeon/vortex">Surgeon - Vortex</a>
    </noscript>
    """
    _mock_async_client(html, monkeypatch)
    adapter = SoundCloudAdapter()

    results = await adapter._fetch_recommended("https://soundcloud.com/rill/onyx-balls-baile", limit=5)

    assert [t.sourceUrl for t in results] == ["https://soundcloud.com/surgeon/vortex"]


# ── _pick_seed validation ─────────────────────────────────────────────────────

async def test_pick_seed_exact_track_match(monkeypatch):
    html = """
    <noscript>
      <a href="/other/random-track">Other - Random Track</a>
      <a href="/ignez/lightworker">Ignez - Lightworker</a>
    </noscript>
    """
    # scores: Other-Random Track pair=MATCH_NONE, Ignez-Lightworker pair=MATCH_EXACT
    async def _fake_score(query, pairs):
        return [MATCH_NONE if "random" in p[1].lower() else MATCH_EXACT for p in pairs]
    monkeypatch.setattr(sc_mod, "score_candidates", _fake_score)
    result = await _pick_seed("Ignez - Lightworker", html)
    assert result == "https://soundcloud.com/ignez/lightworker"


async def test_pick_seed_no_match_returns_none(monkeypatch):
    html = """
    <noscript>
      <a href="/other/unrelated-one">Other - Unrelated One</a>
      <a href="/label/unrelated-two">Label - Unrelated Two</a>
    </noscript>
    """
    async def _fake_score(query, pairs):
        return [MATCH_NONE] * len(pairs)
    monkeypatch.setattr(sc_mod, "score_candidates", _fake_score)
    result = await _pick_seed("Ignez - Lightworker", html)
    assert result is None


async def test_pick_seed_embedded_artist_in_title(monkeypatch):
    # URL/profile is the uploader (a label); the real artist is in the title.
    html = """
    <noscript>
      <a href="/somelabel/ignez-lightworker">Ignez - Lightworker</a>
    </noscript>
    """
    # The title has " - " so two pairs are scored: (uploader, title) and (Ignez, Lightworker).
    # Stub returns MATCH_NONE for the uploader pair, MATCH_EXACT for the embedded pair.
    call_count = []
    async def _fake_score(query, pairs):
        call_count.append(len(pairs))
        # pairs: [(somelabel_name, "Ignez - Lightworker"), ("Ignez", "Lightworker")]
        return [MATCH_NONE, MATCH_EXACT]
    monkeypatch.setattr(sc_mod, "score_candidates", _fake_score)
    result = await _pick_seed("Ignez - Lightworker", html)
    assert result == "https://soundcloud.com/somelabel/ignez-lightworker"
    assert call_count == [2]  # both pairs were scored


async def test_pick_seed_artist_only_query(monkeypatch):
    html = """
    <noscript>
      <a href="/other/unrelated">Other - Unrelated</a>
      <a href="/somelabel/surgeon-vortex">Surgeon - Vortex</a>
    </noscript>
    """
    async def _fake_score(query, pairs):
        # pairs: (Other, Unrelated), (Other, Unrelated embedded split), (somelabel_name, Surgeon - Vortex), (Surgeon, Vortex)
        # only the Surgeon pair (index 2 or 3) matches
        scores = []
        for artist, title in pairs:
            if "surgeon" in artist.lower() or "surgeon" in title.lower():
                scores.append(MATCH_EXACT)
            else:
                scores.append(MATCH_NONE)
        return scores
    monkeypatch.setattr(sc_mod, "score_candidates", _fake_score)
    result = await _pick_seed("Surgeon", html)
    assert result == "https://soundcloud.com/somelabel/surgeon-vortex"


async def test_find_similar_returns_empty_when_no_seed_matches(monkeypatch):
    html = """
    <noscript>
      <a href="/label/unrelated-mix">Label - Unrelated Mix</a>
    </noscript>
    """
    _mock_async_client(html, monkeypatch)
    async def _fake_score(query, pairs):
        return [MATCH_NONE] * len(pairs)
    monkeypatch.setattr(sc_mod, "score_candidates", _fake_score)
    adapter = SoundCloudAdapter()

    assert await adapter.find_similar("Ignez - Lightworker", limit=5) == []
