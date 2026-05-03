"""
Tests for the 1001tracklists adapter.

Mirrors the mocking pattern in test_lastfm.py / test_bandcamp.py:
patch httpx.AsyncClient and the cache helpers (fetch_cooccurrence,
upsert_cooccurrence_batch). Real HTML fixtures live in
tests/fixtures/tracklist1001/ and are pinned with capture date in
their headers — re-capture if 1001TL changes their markup.
"""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.adapters.tracklist1001 import (
    Tracklists1001Adapter,
    _split_query,
)
from app.core.models import TrackMeta


FIXTURES = Path(__file__).parent / "fixtures" / "tracklist1001"


def _fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


def _resp(text: str, status: int = 200) -> MagicMock:
    """Build a mocked httpx Response with .text + .raise_for_status."""
    r = MagicMock(spec=httpx.Response)
    r.text = text
    r.status_code = status
    if status >= 400:
        r.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("err", request=MagicMock(), response=r)
        )
    else:
        r.raise_for_status = MagicMock(return_value=None)
    return r


class _ScriptedClient:
    """
    httpx.AsyncClient stand-in. Routes .get(url, ...) by substring match
    against a list of (substring, response_or_exception) rules. First match
    wins; unmatched URLs raise to make missing rules visible in tests.

    Also exposes `.calls` for asserting request count/order.
    """

    def __init__(self, rules: list[tuple[str, object]]):
        self._rules = rules
        self.calls: list[str] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def get(self, url: str, *args, **kwargs):
        self.calls.append(url)
        for needle, value in self._rules:
            if needle in url:
                if isinstance(value, Exception):
                    raise value
                return value
        raise AssertionError(f"No rule matched URL: {url}")


def _patch_client(client: _ScriptedClient):
    """Patch httpx.AsyncClient so the constructor returns our scripted client."""
    return patch(
        "app.adapters.tracklist1001.httpx.AsyncClient",
        return_value=client,
    )


# Disable rate-limit sleeps so tests run instantly. The real adapter sleeps
# 1s between requests; under test we'd otherwise wait 5+ seconds per case.
@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    async def _noop(_):
        return None
    monkeypatch.setattr("app.adapters.tracklist1001.asyncio.sleep", _noop)


# ── _split_query ──────────────────────────────────────────────────────────────

def test_split_query_artist_track():
    assert _split_query("Oscar Mulero - Horses") == ("Oscar Mulero", "Horses")


def test_split_query_artist_only():
    assert _split_query("Oscar Mulero") == ("Oscar Mulero", None)


def test_split_query_trailing_separator():
    assert _split_query("Oscar Mulero - ") == ("Oscar Mulero", None)


# ── find_similar: artist-only short-circuit ──────────────────────────────────

async def test_artist_only_returns_empty_without_network():
    """No track parsed → return [] without calling the cache or scraping."""
    adapter = Tracklists1001Adapter()
    client = _ScriptedClient([])
    fetch = AsyncMock()
    upsert = AsyncMock()
    with _patch_client(client), \
         patch("app.adapters.tracklist1001.fetch_cooccurrence", fetch), \
         patch("app.adapters.tracklist1001.upsert_cooccurrence_batch", upsert):
        results = await adapter.find_similar("Oscar Mulero")

    assert results == []
    fetch.assert_not_called()
    upsert.assert_not_called()
    assert client.calls == []


# ── find_similar: cache hit ──────────────────────────────────────────────────

async def test_cache_hit_returns_without_scraping():
    cached = [
        TrackMeta(
            title="Faceless",
            artist="Reeko",
            source="tracklist1001",
            sourceUrl="https://www.1001tracklists.com/track/91-pre-track-one",
            score=4.0,
        ),
    ]
    adapter = Tracklists1001Adapter()
    client = _ScriptedClient([])  # no network rules → would AssertionError if called
    upsert = AsyncMock()
    with _patch_client(client), \
         patch("app.adapters.tracklist1001.fetch_cooccurrence",
               AsyncMock(return_value=cached)), \
         patch("app.adapters.tracklist1001.upsert_cooccurrence_batch", upsert):
        results = await adapter.find_similar("Oscar Mulero - Horses")

    assert results == cached
    assert client.calls == []  # no network on cache hit
    upsert.assert_not_called()  # no rewrite on cache hit


# ── find_similar: full scrape path ──────────────────────────────────────────

def _full_scrape_rules() -> list[tuple[str, object]]:
    """
    Three-rule script for cache-miss path:
      1) /search/index.php → search_hit.html (gives seed slug 12345-...)
      2) /track/12345-...  → seed_page.html  (3 unique set URLs)
      3) /tracklist/...    → set_page.html   (5 tracks; seed at idx 2)
    Same set_page is returned for all 3 sets, so each adjacent track
    co-occurs in 3 sets → setCount = 3.
    """
    return [
        ("/search/index.php", _resp(_fixture("search_hit.html"))),
        ("/track/12345-oscar-mulero-horses", _resp(_fixture("seed_page.html"))),
        ("/tracklist/", _resp(_fixture("set_page.html"))),
    ]


async def test_cache_miss_scrape_writes_back_and_returns_pairs():
    adapter = Tracklists1001Adapter()
    client = _ScriptedClient(_full_scrape_rules())
    upsert = AsyncMock()
    with _patch_client(client), \
         patch("app.adapters.tracklist1001.fetch_cooccurrence",
               AsyncMock(return_value=[])), \
         patch("app.adapters.tracklist1001.upsert_cooccurrence_batch", upsert):
        results = await adapter.find_similar("Oscar Mulero - Horses")

    # Window ±2 around seed (idx 2) in a 5-track set excludes the seed itself
    # → 4 adjacent tracks. Each set is identical, so each co-occurs 3 times.
    assert len(results) == 4
    artists = sorted(t.artist for t in results)
    assert artists == ["Architectural", "Exium", "Linear System", "Reeko"]
    for t in results:
        assert t.source == "tracklist1001"
        assert t.score == 3.0
        assert t.sourceUrl.startswith("https://www.1001tracklists.com/track/")

    # Persisted to cache exactly once with the full set of pairs.
    upsert.assert_awaited_once()
    kwargs = upsert.await_args.kwargs
    assert kwargs["seed_artist"] == "Oscar Mulero"
    assert kwargs["seed_track"] == "Horses"
    assert len(kwargs["pairs"]) == 4


async def test_cache_miss_search_returns_no_seed_short_circuits():
    """Empty search HTML → no seed id → don't fetch seed page or sets."""
    adapter = Tracklists1001Adapter()
    rules = [("/search/index.php", _resp(_fixture("search_empty.html")))]
    client = _ScriptedClient(rules)
    upsert = AsyncMock()
    with _patch_client(client), \
         patch("app.adapters.tracklist1001.fetch_cooccurrence",
               AsyncMock(return_value=[])), \
         patch("app.adapters.tracklist1001.upsert_cooccurrence_batch", upsert):
        results = await adapter.find_similar("Some Unknown - Track")

    assert results == []
    assert len(client.calls) == 1  # only the search call was made
    upsert.assert_not_called()  # nothing to persist


async def test_seed_page_with_no_sets_returns_empty():
    """Seed page parses but lists no DJ sets → no adjacency to compute."""
    adapter = Tracklists1001Adapter()
    rules = [
        ("/search/index.php", _resp(_fixture("search_hit.html"))),
        ("/track/12345-oscar-mulero-horses", _resp(_fixture("seed_page_empty.html"))),
    ]
    client = _ScriptedClient(rules)
    upsert = AsyncMock()
    with _patch_client(client), \
         patch("app.adapters.tracklist1001.fetch_cooccurrence",
               AsyncMock(return_value=[])), \
         patch("app.adapters.tracklist1001.upsert_cooccurrence_batch", upsert):
        results = await adapter.find_similar("Oscar Mulero - Horses")

    assert results == []
    upsert.assert_not_called()


async def test_set_without_seed_contributes_no_pairs():
    """A set page that doesn't contain the seed → adjacency returns []."""
    adapter = Tracklists1001Adapter()
    rules = [
        ("/search/index.php", _resp(_fixture("search_hit.html"))),
        ("/track/12345-oscar-mulero-horses", _resp(_fixture("seed_page.html"))),
        ("/tracklist/", _resp(_fixture("set_page_no_seed.html"))),
    ]
    client = _ScriptedClient(rules)
    upsert = AsyncMock()
    with _patch_client(client), \
         patch("app.adapters.tracklist1001.fetch_cooccurrence",
               AsyncMock(return_value=[])), \
         patch("app.adapters.tracklist1001.upsert_cooccurrence_batch", upsert):
        results = await adapter.find_similar("Oscar Mulero - Horses")

    assert results == []
    upsert.assert_not_called()


# ── Resilience: per-step parse failures don't kill the whole scrape ─────────

async def test_one_set_failing_does_not_abort_scrape(capsys):
    """One set raises during fetch; the others contribute normally."""
    adapter = Tracklists1001Adapter()
    rules = [
        ("/search/index.php", _resp(_fixture("search_hit.html"))),
        ("/track/12345-oscar-mulero-horses", _resp(_fixture("seed_page.html"))),
        # First set raises; second and third succeed via the catch-all rule.
        ("abc111", httpx.ConnectError("boom")),
        ("/tracklist/", _resp(_fixture("set_page.html"))),
    ]
    client = _ScriptedClient(rules)
    upsert = AsyncMock()
    with _patch_client(client), \
         patch("app.adapters.tracklist1001.fetch_cooccurrence",
               AsyncMock(return_value=[])), \
         patch("app.adapters.tracklist1001.upsert_cooccurrence_batch", upsert):
        results = await adapter.find_similar("Oscar Mulero - Horses")

    # 2 successful sets × 4 adjacent tracks (deduped) = 4 unique with setCount=2
    assert len(results) == 4
    for t in results:
        assert t.score == 2.0

    captured = capsys.readouterr()
    assert "[Tracklist1001]" in captured.out  # error logged to stdout


async def test_search_network_failure_returns_empty(capsys):
    adapter = Tracklists1001Adapter()
    rules = [("/search/index.php", httpx.ConnectError("nope"))]
    client = _ScriptedClient(rules)
    with _patch_client(client), \
         patch("app.adapters.tracklist1001.fetch_cooccurrence",
               AsyncMock(return_value=[])), \
         patch("app.adapters.tracklist1001.upsert_cooccurrence_batch", AsyncMock()):
        results = await adapter.find_similar("X - Y")

    assert results == []
    assert "[Tracklist1001]" in capsys.readouterr().out


# ── Budget enforcement ─────────────────────────────────────────────────────

async def test_budget_exceeded_returns_partial_results(monkeypatch):
    """
    Force time.monotonic to advance past the 8s budget after the first set
    is fetched. Adapter should return whatever it managed to collect from
    that one set, not block on the remaining 2.
    """
    adapter = Tracklists1001Adapter()
    rules = [
        ("/search/index.php", _resp(_fixture("search_hit.html"))),
        ("/track/12345-oscar-mulero-horses", _resp(_fixture("seed_page.html"))),
        ("/tracklist/", _resp(_fixture("set_page.html"))),
    ]
    client = _ScriptedClient(rules)

    # Scripted clock — _scrape_with_budget calls monotonic in this order:
    #   1) deadline init           (returns 0)
    #   2) post-find-seed check    (returns 0)
    #   3) loop iter 1, set #1     (returns 0 → process)
    #   4) loop iter 2, set #2     (returns 100 → past deadline, break)
    # So exactly 1 set contributes before the budget burns out.
    times = iter([0.0, 0.0, 0.0, 100.0, 100.0, 100.0])

    def fake_monotonic():
        try:
            return next(times)
        except StopIteration:
            return 100.0

    monkeypatch.setattr("app.adapters.tracklist1001.time.monotonic", fake_monotonic)

    with _patch_client(client), \
         patch("app.adapters.tracklist1001.fetch_cooccurrence",
               AsyncMock(return_value=[])), \
         patch("app.adapters.tracklist1001.upsert_cooccurrence_batch", AsyncMock()):
        results = await adapter.find_similar("Oscar Mulero - Horses")

    # Only the first of 3 sets contributed before the budget burned out.
    assert len(results) == 4
    for t in results:
        assert t.score == 1.0


# ── random_techno_track ─────────────────────────────────────────────────────

async def test_random_techno_track_returns_none():
    assert await Tracklists1001Adapter().random_techno_track() is None
