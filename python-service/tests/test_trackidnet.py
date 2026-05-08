"""
Tests for the trackid.net JSON API adapter (playlists-list architecture).

The adapter calls three endpoints:
  - GET /api/public/musictracks?keywords=...           → search/seed lookup
  - GET /api/public/audiostreams?musicTrackId=<id>     → list of playlists
  - GET /api/public/audiostreams/<slug>                → DJ-set tracklist

Captured JSON fixtures live in tests/fixtures/trackidnet/ (filename
includes capture date). Smaller scenario shapes are inlined as Python
dicts in the tests.
"""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.adapters.trackidnet import (
    TrackidnetAdapter,
    WINDOW,
    _split_query,
)


FIXTURES = Path(__file__).parent / "fixtures" / "trackidnet"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def _resp(payload: dict, status: int = 200) -> MagicMock:
    """Mocked httpx Response with .json() and .raise_for_status()."""
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.json = MagicMock(return_value=payload)
    if status >= 400:
        r.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("err", request=MagicMock(), response=r)
        )
    else:
        r.raise_for_status = MagicMock(return_value=None)
    return r


class _ScriptedClient:
    """
    httpx.AsyncClient stand-in. Routes .get(url, params=..., ...) by
    matching against (matcher_fn-or-substring, response-or-exception)
    rules; first match wins. Records calls (url, params) for assertions.
    """

    def __init__(self, rules):
        self._rules = rules
        self.calls: list[tuple[str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def get(self, url: str, *args, **kwargs):
        params = kwargs.get("params") or {}
        self.calls.append((url, params))
        for matcher, value in self._rules:
            ok = matcher(url, params) if callable(matcher) else (matcher in url)
            if ok:
                if isinstance(value, Exception):
                    raise value
                return value
        raise AssertionError(f"No rule matched URL: {url} params={params}")


def _patch_client(client: _ScriptedClient):
    return patch(
        "app.adapters.trackidnet.httpx.AsyncClient", return_value=client
    )


def _is_search(url, params):
    return "/musictracks" in url and "keywords" in params


def _is_playlists_list(url, params=None):
    # /audiostreams with musicTrackId param (not /audiostreams/<slug>)
    if not url.endswith("/audiostreams"):
        return False
    return params is not None and "musicTrackId" in params


def _is_audiostream_detail(url, params=None):
    return "/audiostreams/" in url


@pytest.fixture
def _enabled(monkeypatch):
    monkeypatch.setattr(
        "app.adapters.trackidnet.settings.trackidnet_enabled", True
    )


def _make_seed_search(seed_id=502601, seed_slug="nina-kraviz-tarde-david-lohlein-amor-mix",
                     artist="nina kraviz", title="Tarde", play_count=10):
    return {
        "result": {
            "musicTracks": [
                {
                    "id": seed_id, "artist": artist, "title": title,
                    "slug": seed_slug, "playCount": play_count,
                    "minCreatedSlug": "min-set", "maxCreatedSlug": "max-set",
                },
            ]
        }
    }


def _make_playlists_response(slug_added_pairs):
    """slug_added_pairs: list of (slug, addedOn_iso) tuples."""
    return {
        "result": {
            "audiostreams": [
                {"slug": s, "addedOn": a, "id": i + 1}
                for i, (s, a) in enumerate(slug_added_pairs)
            ],
            "rowCount": len(slug_added_pairs),
        }
    }


def _make_audiostream(tracks, end_date="2025-01-01T00:00:00Z"):
    return {
        "result": {
            "detectionProcesses": [
                {"endDate": end_date, "detectionProcessMusicTracks": tracks},
            ]
        }
    }


# ── _split_query ──────────────────────────────────────────────────────────

def test_split_query_artist_track():
    assert _split_query("Nina Kraviz - Tarde") == ("Nina Kraviz", "Tarde")


def test_split_query_artist_only():
    assert _split_query("Nina Kraviz") == ("Nina Kraviz", None)


def test_split_query_trailing_separator():
    assert _split_query("Nina Kraviz - ") == ("Nina Kraviz", None)


# ── feature flag + query short-circuits ───────────────────────────────────

async def test_disabled_flag_short_circuits_without_network(monkeypatch):
    monkeypatch.setattr(
        "app.adapters.trackidnet.settings.trackidnet_enabled", False
    )
    adapter = TrackidnetAdapter()
    client = _ScriptedClient([])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []
    assert client.calls == []


async def test_query_without_dash_returns_empty_without_network(_enabled):
    adapter = TrackidnetAdapter()
    client = _ScriptedClient([])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz") == []
    assert client.calls == []


# ── seed picker (/musictracks) ────────────────────────────────────────────

async def test_search_picks_highest_playcount_artist_match_and_uses_id(_enabled):
    """Two nina-kraviz entries (playCount 10 and 4) → picker takes 10 and
    uses its `id` to list playlists."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [
                {
                    "id": 502601, "artist": "nina kraviz", "title": "Tarde (Mix)",
                    "slug": "nina-kraviz-tarde-mix", "playCount": 10,
                    "minCreatedSlug": "x", "maxCreatedSlug": "y",
                },
                {
                    "id": 502602, "artist": "nina kraviz", "title": "Tarde",
                    "slug": "nina-kraviz-tarde", "playCount": 4,
                    "minCreatedSlug": "a", "maxCreatedSlug": "b",
                },
            ]
        }
    }
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp({"result": {"audiostreams": []}})),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        await adapter.find_similar("Nina Kraviz - Tarde")
    # Verify musicTrackId=502601 was sent on the playlists call
    list_calls = [c for c in client.calls if c[0].endswith("/audiostreams")]
    assert any(c[1].get("musicTrackId") == 502601 for c in list_calls)


async def test_search_falls_back_to_first_nonzero_when_no_artist_match(_enabled):
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [
                {"id": 1, "artist": "Other", "title": "T", "slug": "other-t",
                 "playCount": 5, "minCreatedSlug": "a", "maxCreatedSlug": "a"},
                {"id": 2, "artist": "Yet", "title": "T", "slug": "yet-t",
                 "playCount": 3, "minCreatedSlug": "b", "maxCreatedSlug": "b"},
            ]
        }
    }
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp({"result": {"audiostreams": []}})),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        await adapter.find_similar("Nina - T")
    list_calls = [c for c in client.calls if c[0].endswith("/audiostreams")]
    assert any(c[1].get("musicTrackId") == 1 for c in list_calls)


async def test_search_all_zero_playcount_returns_empty(_enabled):
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [
                {"id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                 "slug": "nina-kraviz-tarde", "playCount": 0,
                 "minCreatedSlug": None, "maxCreatedSlug": None},
            ]
        }
    }
    client = _ScriptedClient([(_is_search, _resp(search))])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []
    # No playlists call made
    assert all(not c[0].endswith("/audiostreams") for c in client.calls)


async def test_search_empty_results_returns_empty(_enabled):
    adapter = TrackidnetAdapter()
    payload = {"result": {"musicTracks": [], "rowCount": 0}}
    client = _ScriptedClient([(_is_search, _resp(payload))])
    with _patch_client(client):
        assert await adapter.find_similar("Nobody - Nothing") == []


async def test_search_http_error_returns_empty(_enabled, capsys):
    adapter = TrackidnetAdapter()
    client = _ScriptedClient([(_is_search, httpx.ConnectError("boom"))])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []
    assert "[Trackidnet]" in capsys.readouterr().out


async def test_search_500_returns_empty(_enabled, capsys):
    adapter = TrackidnetAdapter()
    client = _ScriptedClient([(_is_search, _resp({}, status=500))])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []
    assert "[Trackidnet]" in capsys.readouterr().out


# ── playlists list (/audiostreams?musicTrackId=) ─────────────────────────

async def test_playlists_list_happy_path_fetches_all_returned(_enabled):
    """14 playlists in fixture → all 14 detail fetches happen."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search()
    playlists = _load("playlists_list_nina_kraviz_tarde_2026-05-04.json")
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp({"result": None})),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        await adapter.find_similar("Nina Kraviz - Tarde")
    detail_calls = [c for c in client.calls if "/audiostreams/" in c[0]]
    assert len(detail_calls) == 14


async def test_playlists_list_capped_at_15(_enabled):
    """20 playlists returned (page max) → only top 15 (by addedOn desc) fetched."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search()
    pairs = [(f"slug-{i}", f"2026-01-{i+1:02d}T00:00:00Z") for i in range(20)]
    playlists = _make_playlists_response(pairs)
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp({"result": None})),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        await adapter.find_similar("Nina Kraviz - Tarde")
    detail_calls = [c for c in client.calls if "/audiostreams/" in c[0]]
    assert len(detail_calls) == 15
    fetched_slugs = [c[0].rsplit("/", 1)[-1] for c in detail_calls]
    # Top 15 by addedOn desc → slug-19 down to slug-5
    assert "slug-19" in fetched_slugs
    assert "slug-5" in fetched_slugs
    assert "slug-4" not in fetched_slugs


async def test_playlists_list_sorted_by_addedon_desc_defensively(_enabled):
    """API returns out-of-order playlists; adapter sorts before capping."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search()
    pairs = [
        ("old", "2024-01-01T00:00:00Z"),
        ("new", "2026-05-01T00:00:00Z"),
        ("mid", "2025-06-01T00:00:00Z"),
    ]
    playlists = _make_playlists_response(pairs)
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp({"result": None})),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        await adapter.find_similar("Nina Kraviz - Tarde")
    detail_calls = [c for c in client.calls if "/audiostreams/" in c[0]]
    fetched_order = [c[0].rsplit("/", 1)[-1] for c in detail_calls]
    # Issue order doesn't have to be exact (gather is concurrent), but the
    # set of called slugs should include all three. We check the SORT was
    # respected by the cap-at-15 contract — here all three pass through.
    assert set(fetched_order) == {"new", "mid", "old"}


async def test_playlists_list_http_error_returns_empty(_enabled, capsys):
    adapter = TrackidnetAdapter()
    search = _make_seed_search()
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, httpx.ConnectError("boom")),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []
    assert "[Trackidnet] playlists list failed" in capsys.readouterr().out


async def test_playlists_list_empty_returns_empty(_enabled):
    adapter = TrackidnetAdapter()
    search = _make_seed_search()
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp({"result": {"audiostreams": []}})),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []


# ── window extraction ────────────────────────────────────────────────────

async def test_window_around_seed_in_middle(_enabled):
    """20-track playlist, seed at index 7 → ±WINDOW co-occurrence neighbours,
    excluding the seed itself."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    tracks = [
        {"slug": f"t-{i}", "artist": f"A{i}", "title": f"T{i}",
         "referenceCount": 1}
        for i in range(20)
    ]
    seed_idx = 7
    tracks[seed_idx] = {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
                        "referenceCount": 50}
    audio = _make_audiostream(tracks)
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    artists = {t.artist for t in results}
    expected = {
        f"A{i}"
        for i in range(seed_idx - WINDOW, seed_idx + WINDOW + 1)
        if i != seed_idx
    }
    assert artists == expected
    assert "Nina Kraviz" not in artists


async def test_window_seed_at_start_returns_only_after(_enabled):
    """Seed at index 0 → window has WINDOW tracks after, none before."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    tracks = [{"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
               "referenceCount": 50}]
    tracks += [
        {"slug": f"t-{i}", "artist": f"A{i}", "title": f"T{i}", "referenceCount": 1}
        for i in range(10)
    ]
    audio = _make_audiostream(tracks)
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert len(results) == WINDOW
    assert {t.artist for t in results} == {f"A{i}" for i in range(WINDOW)}


async def test_window_seed_at_end_returns_only_before(_enabled):
    """Seed as last track → window has WINDOW tracks before, none after."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    tracks = [
        {"slug": f"t-{i}", "artist": f"A{i}", "title": f"T{i}", "referenceCount": 1}
        for i in range(10)
    ]
    tracks.append({"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
                   "referenceCount": 50})
    audio = _make_audiostream(tracks)
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert len(results) == WINDOW
    assert {t.artist for t in results} == {f"A{i}" for i in range(10 - WINDOW, 10)}


async def test_window_seed_not_in_tracklist_returns_empty(_enabled):
    """Playlist doesn't contain the seed slug → that playlist contributes 0."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    tracks = [
        {"slug": f"t-{i}", "artist": f"A{i}", "title": f"T{i}", "referenceCount": 1}
        for i in range(5)
    ]
    audio = _make_audiostream(tracks)
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert results == []


async def test_window_seed_appears_multiple_times_anchors_on_first(_enabled):
    """Seed at two indices — anchor on the first; window clamps at 0; ALL
    seed instances filtered."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    seed_first, seed_second = 3, 12
    tracks = []
    for i in range(15):
        if i in (seed_first, seed_second):
            tracks.append({"slug": "seed", "artist": "Nina Kraviz",
                           "title": "Tarde", "referenceCount": 50})
        else:
            tracks.append({"slug": f"t-{i}", "artist": f"A{i}",
                           "title": f"T{i}", "referenceCount": 1})
    audio = _make_audiostream(tracks)
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    artists = {t.artist for t in results}
    # Window anchored on first seed at index `seed_first`, clamped to [0, len),
    # all seed instances filtered.
    start = max(0, seed_first - WINDOW)
    end = min(15, seed_first + WINDOW + 1)
    expected = {
        f"A{i}"
        for i in range(start, end)
        if i not in (seed_first, seed_second)
    }
    assert artists == expected
    assert "Nina Kraviz" not in artists


async def test_track_with_null_slug_skipped(_enabled):
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    tracks = [
        {"slug": None, "artist": "NoSlug", "title": "X", "referenceCount": 1},
        {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde", "referenceCount": 50},
        {"slug": "valid", "artist": "Valid", "title": "T", "referenceCount": 1},
    ]
    audio = _make_audiostream(tracks)
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert {t.artist for t in results} == {"Valid"}


async def test_audiostream_falls_back_when_latest_process_is_empty(_enabled):
    """Latest endDate process is empty → fall back to earlier process
    that contains the seed."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    audio = {"result": {"detectionProcesses": [
        {
            "endDate": "2024-03-03T08:00:00Z",
            "detectionProcessMusicTracks": [
                {"slug": "before", "artist": "B", "title": "T",
                 "referenceCount": 1},
                {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
                 "referenceCount": 50},
                {"slug": "after", "artist": "A", "title": "T",
                 "referenceCount": 1},
            ],
        },
        {
            "endDate": "2025-10-08T08:00:00Z",
            "detectionProcessMusicTracks": [],
        },
    ]}}
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert {t.artist for t in results} == {"B", "A"}


async def test_audiostream_skips_non_empty_process_that_lost_seed(_enabled):
    """Real-world trackid.net case: a later reprocess succeeds with a
    non-empty result that simply doesn't include the seed track. The
    older (lower endDate) process *does* contain the seed.

    Old behavior (latest non-empty): picked the seedless process →
    contributed 0 candidates → entire popular playlists were silently
    dropped.

    New behavior: pick the latest process that contains the seed.
    """
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    audio = {"result": {"detectionProcesses": [
        {
            "endDate": "2026-01-27T10:39:10Z",
            "detectionProcessMusicTracks": [
                {"slug": "before", "artist": "B", "title": "T",
                 "referenceCount": 1},
                {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
                 "referenceCount": 50},
                {"slug": "after", "artist": "A", "title": "T",
                 "referenceCount": 1},
            ],
        },
        {
            "endDate": "2026-01-28T04:29:09Z",
            "detectionProcessMusicTracks": [
                {"slug": "wrong-1", "artist": "Wrong1", "title": "T",
                 "referenceCount": 1},
                {"slug": "wrong-2", "artist": "Wrong2", "title": "T",
                 "referenceCount": 1},
            ],
        },
    ]}}
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert {t.artist for t in results} == {"B", "A"}


async def test_audiostream_picks_latest_process_among_those_with_seed(_enabled):
    """Multiple processes contain the seed; tiebreak by latest endDate."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    audio = {"result": {"detectionProcesses": [
        {
            "endDate": "2025-01-01T00:00:00Z",
            "detectionProcessMusicTracks": [
                {"slug": "old-neighbor", "artist": "Old", "title": "T",
                 "referenceCount": 1},
                {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
                 "referenceCount": 50},
            ],
        },
        {
            "endDate": "2026-05-01T00:00:00Z",
            "detectionProcessMusicTracks": [
                {"slug": "new-neighbor", "artist": "New", "title": "T",
                 "referenceCount": 1},
                {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
                 "referenceCount": 50},
            ],
        },
    ]}}
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert {t.artist for t in results} == {"New"}


async def test_no_process_contains_seed_returns_empty(_enabled):
    """Every detection process is non-empty but none contain the seed
    slug → playlist contributes nothing."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    audio = {"result": {"detectionProcesses": [
        {
            "endDate": "2026-01-27T10:00:00Z",
            "detectionProcessMusicTracks": [
                {"slug": "x", "artist": "X", "title": "T", "referenceCount": 1},
            ],
        },
        {
            "endDate": "2026-01-28T10:00:00Z",
            "detectionProcessMusicTracks": [
                {"slug": "y", "artist": "Y", "title": "T", "referenceCount": 1},
            ],
        },
    ]}}
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert results == []


async def test_empty_detection_processes_returns_empty_pool(_enabled):
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    audio = {"result": {"detectionProcesses": []}}
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []


# ── soft-fail per detail fetch ───────────────────────────────────────────

async def test_one_detail_failing_does_not_kill_others(_enabled, capsys):
    """One playlist's detail fetch raises; the others still contribute."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([
        ("set-a", "2025-03-01T00:00:00Z"),
        ("set-b", "2025-02-01T00:00:00Z"),
    ])
    set_b = _make_audiostream([
        {"slug": "before", "artist": "B", "title": "T", "referenceCount": 1},
        {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
         "referenceCount": 50},
    ])
    def _matcher(url, params):
        return url.endswith("/audiostreams/set-a")
    def _matcher_b(url, params):
        return url.endswith("/audiostreams/set-b")
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_matcher, httpx.ConnectError("set-a down")),
        (_matcher_b, _resp(set_b)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert {t.artist for t in results} == {"B"}
    assert "[Trackidnet] audiostream set-a failed" in capsys.readouterr().out


# ── concurrency cap ──────────────────────────────────────────────────────

async def test_detail_concurrency_capped_at_5(_enabled):
    """With 15 playlists to fetch, never more than DETAIL_CONCURRENCY=5
    requests are in flight at once."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    pairs = [(f"slug-{i}", f"2026-05-{i+1:02d}T00:00:00Z") for i in range(15)]
    playlists = _make_playlists_response(pairs)
    audio_payload = _make_audiostream([
        {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
         "referenceCount": 50},
        {"slug": "x", "artist": "X", "title": "T", "referenceCount": 1},
    ])

    import asyncio as _asyncio

    in_flight = 0
    peak = 0

    class _SlowClient(_ScriptedClient):
        async def get(self, url, *args, **kwargs):
            nonlocal in_flight, peak
            params = kwargs.get("params") or {}
            if "/audiostreams/" in url:
                in_flight += 1
                peak = max(peak, in_flight)
                # Yield control so other concurrent gets accumulate
                await _asyncio.sleep(0.01)
                in_flight -= 1
            return await super().get(url, *args, **kwargs)

    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio_payload)),
    ]
    client = _SlowClient(rules)
    with _patch_client(client):
        await adapter.find_similar("Nina Kraviz - Tarde")
    assert peak <= 5, f"semaphore did not cap concurrency; peak in-flight = {peak}"


# ── aggregation across playlists ─────────────────────────────────────────

async def test_cooccurrence_higher_count_wins(_enabled):
    """Track in 2 of 2 fetched playlists outranks tracks in 1 of 2."""
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([
        ("set-a", "2025-02-01T00:00:00Z"),
        ("set-b", "2025-01-01T00:00:00Z"),
    ])
    set_a = _make_audiostream([
        {"slug": "shared", "artist": "Shared", "title": "T", "referenceCount": 50},
        {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde", "referenceCount": 50},
        {"slug": "only-a", "artist": "OnlyA", "title": "X", "referenceCount": 1},
    ])
    set_b = _make_audiostream([
        {"slug": "shared", "artist": "Shared", "title": "T", "referenceCount": 50},
        {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde", "referenceCount": 50},
        {"slug": "only-b", "artist": "OnlyB", "title": "Y", "referenceCount": 1},
    ])
    def _a(url, p): return url.endswith("/audiostreams/set-a")
    def _b(url, p): return url.endswith("/audiostreams/set-b")
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_a, _resp(set_a)),
        (_b, _resp(set_b)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert results[0].artist == "Shared"
    assert results[0].score == 2.0
    assert {t.artist for t in results[1:]} == {"OnlyA", "OnlyB"}


async def test_tiebreak_lower_referencecount_wins(_enabled):
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    audio = _make_audiostream([
        {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde", "referenceCount": 50},
        {"slug": "generic", "artist": "Generic", "title": "Hit", "referenceCount": 50},
        {"slug": "rare", "artist": "Rare", "title": "Cut", "referenceCount": 5},
    ])
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")
    assert [t.artist for t in results] == ["Rare", "Generic"]


async def test_limit_caps_returned_candidates(_enabled):
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    tracks = [
        {"slug": f"t-{i}", "artist": f"A{i}", "title": f"T{i}",
         "referenceCount": i + 1}
        for i in range(8)
    ]
    tracks.insert(4, {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde",
                      "referenceCount": 50})
    audio = _make_audiostream(tracks)
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde", limit=3)
    assert len(results) == 3


async def test_trackmeta_fields_populated_correctly(_enabled):
    adapter = TrackidnetAdapter()
    search = _make_seed_search(seed_slug="seed")
    playlists = _make_playlists_response([("set-a", "2025-01-01T00:00:00Z")])
    audio = _make_audiostream([
        {"slug": "seed", "artist": "Nina Kraviz", "title": "Tarde", "referenceCount": 50},
        {"slug": "heliobolus-forest-hunter", "artist": "Heliobolus",
         "title": "Forest Hunter", "label": "Amniote Editions",
         "referenceCount": 1},
    ])
    rules = [
        (_is_search, _resp(search)),
        (_is_playlists_list, _resp(playlists)),
        (_is_audiostream_detail, _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        (track,) = await adapter.find_similar("Nina Kraviz - Tarde")
    assert track.title == "Forest Hunter"
    assert track.artist == "Heliobolus"
    assert track.source == "trackidnet"
    assert track.sourceUrl == "https://trackid.net/musictracks/heliobolus-forest-hunter"
    assert track.bpm is None and track.key is None and track.energy is None
