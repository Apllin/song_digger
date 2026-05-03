"""
Tests for the trackid.net JSON API adapter.

The adapter calls two endpoints:
  - GET /api/public/musictracks?keywords=... → search/seed lookup
  - GET /api/public/audiostreams/<slug>     → DJ-set tracklist

Captured JSON fixtures live in tests/fixtures/trackidnet/ and are pinned
with the capture date in their filename (re-capture if the upstream
schema shifts). Smaller scenario-specific shapes are inlined as Python
dicts in the tests themselves.
"""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.adapters.trackidnet import (
    TrackidnetAdapter,
    _split_query,
)


FIXTURES = Path(__file__).parent / "fixtures" / "trackidnet"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def _resp(payload: dict, status: int = 200) -> MagicMock:
    """Mocked httpx Response with a working .json() and .raise_for_status()."""
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
    httpx.AsyncClient stand-in. Routes .get(url, ...) by substring match
    against (substring, response-or-exception) rules; first match wins.
    Unmatched URLs raise so missing rules surface in tests.
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
    return patch(
        "app.adapters.trackidnet.httpx.AsyncClient", return_value=client
    )


@pytest.fixture
def _enabled(monkeypatch):
    monkeypatch.setattr(
        "app.adapters.trackidnet.settings.trackidnet_enabled", True
    )


# ── _split_query ──────────────────────────────────────────────────────────

def test_split_query_artist_track():
    assert _split_query("Nina Kraviz - Tarde") == ("Nina Kraviz", "Tarde")


def test_split_query_artist_only():
    assert _split_query("Nina Kraviz") == ("Nina Kraviz", None)


def test_split_query_trailing_separator():
    assert _split_query("Nina Kraviz - ") == ("Nina Kraviz", None)


# ── feature flag ──────────────────────────────────────────────────────────

async def test_disabled_by_default_returns_empty_without_network():
    """Default trackidnet_enabled=False short-circuits before any httpx call."""
    adapter = TrackidnetAdapter()
    client = _ScriptedClient([])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []
    assert client.calls == []


# ── query shape short-circuit ─────────────────────────────────────────────

async def test_query_without_dash_returns_empty_without_network(_enabled):
    """An artist-only query has no track to search by — early return."""
    adapter = TrackidnetAdapter()
    client = _ScriptedClient([])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz") == []
    assert client.calls == []


# ── seed picker (/musictracks) ────────────────────────────────────────────

async def test_search_picks_highest_playcount_artist_match(_enabled):
    """Two nina-kraviz entries (playCount 10 and 4) → picker takes 10."""
    adapter = TrackidnetAdapter()
    rules = [
        ("/musictracks", _resp(_load("search_nina_kraviz_tarde_2026-05-04.json"))),
        ("/audiostreams/", _resp({"result": None})),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        await adapter.find_similar("Nina Kraviz - Tarde")
    # Two audiostream lookups: minCreatedSlug + maxCreatedSlug of the
    # playCount=10 entry.
    audiostream_calls = [c for c in client.calls if "/audiostreams/" in c]
    assert any("heisss-podcast-015-david-lohlein" in c for c in audiostream_calls)
    assert any("nina-kraviz-neversea-kapital-2025" in c for c in audiostream_calls)


async def test_search_falls_back_to_first_nonzero_when_no_artist_match(_enabled):
    """No exact artist match → first entry with playCount > 0."""
    adapter = TrackidnetAdapter()
    payload = {
        "result": {
            "musicTracks": [
                {
                    "id": 1, "artist": "Other Artist", "title": "Track",
                    "slug": "other-artist-track", "playCount": 5,
                    "minCreatedSlug": "set-a", "maxCreatedSlug": "set-a",
                },
                {
                    "id": 2, "artist": "Yet Another", "title": "Track",
                    "slug": "yet-another-track", "playCount": 3,
                    "minCreatedSlug": "set-b", "maxCreatedSlug": "set-b",
                },
            ]
        }
    }
    rules = [
        ("/musictracks", _resp(payload)),
        ("/audiostreams/set-a", _resp({"result": None})),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        await adapter.find_similar("Nina Kraviz - Track")
    # Picker chose the first nonzero entry; only its set-a was fetched.
    assert any("/audiostreams/set-a" in c for c in client.calls)
    assert not any("/audiostreams/set-b" in c for c in client.calls)


async def test_search_all_zero_playcount_returns_empty(_enabled):
    """Catalogue-only entries (no plays) carry no co-occurrence signal."""
    adapter = TrackidnetAdapter()
    payload = {
        "result": {
            "musicTracks": [
                {"id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                 "slug": "nina-kraviz-tarde", "playCount": 0,
                 "minCreatedSlug": None, "maxCreatedSlug": None},
            ]
        }
    }
    client = _ScriptedClient([("/musictracks", _resp(payload))])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []
    assert all("/audiostreams/" not in c for c in client.calls)


async def test_search_empty_results_returns_empty(_enabled):
    adapter = TrackidnetAdapter()
    payload = {"result": {"musicTracks": [], "rowCount": 0}}
    client = _ScriptedClient([("/musictracks", _resp(payload))])
    with _patch_client(client):
        assert await adapter.find_similar("Nobody - Nothing") == []


async def test_search_http_error_returns_empty(_enabled, capsys):
    adapter = TrackidnetAdapter()
    client = _ScriptedClient([("/musictracks", httpx.ConnectError("boom"))])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []
    assert "[Trackidnet]" in capsys.readouterr().out


async def test_search_500_returns_empty(_enabled, capsys):
    adapter = TrackidnetAdapter()
    client = _ScriptedClient([("/musictracks", _resp({}, status=500))])
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []
    assert "[Trackidnet]" in capsys.readouterr().out


# ── audiostream / co-occurrence aggregation ───────────────────────────────

async def test_audiostream_uses_latest_detection_process(_enabled):
    """Fixture has 2 processes; latest endDate (2025-03-31) supplies tracks."""
    adapter = TrackidnetAdapter()
    search = _load("search_nina_kraviz_tarde_2026-05-04.json")
    audiostream = _load("audiostream_val_vashar_2026-05-04.json")
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/", _resp(audiostream)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")

    artists = {t.artist for t in results}
    # Latest process tracks (Reprocessed / Stranger / Newer) — two
    # audiostreams fetched both return the same fixture, so each appears
    # twice → co-occurrence count 2 for all three.
    assert artists == {"Reprocessed", "Stranger", "Newer"}
    # Earlier-process names must not leak in.
    assert "Heliobolus" not in artists
    assert "Cleric" not in artists
    for t in results:
        assert t.score == 2.0


async def test_cooccurrence_count_2_outranks_count_1(_enabled):
    """Track present in BOTH fetched sets ranks above singletons."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed-slug", "playCount": 2,
                "minCreatedSlug": "set-a", "maxCreatedSlug": "set-b",
            }]
        }
    }
    set_a = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": "shared", "artist": "Shared", "title": "Track", "referenceCount": 50},
            {"slug": "only-a", "artist": "OnlyA", "title": "X", "referenceCount": 1},
        ],
    }]}}
    set_b = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": "shared", "artist": "Shared", "title": "Track", "referenceCount": 50},
            {"slug": "only-b", "artist": "OnlyB", "title": "Y", "referenceCount": 1},
        ],
    }]}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/set-a", _resp(set_a)),
        ("/audiostreams/set-b", _resp(set_b)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")

    assert results[0].artist == "Shared"
    assert results[0].score == 2.0
    assert {t.artist for t in results[1:]} == {"OnlyA", "OnlyB"}
    for t in results[1:]:
        assert t.score == 1.0


async def test_tiebreak_lower_referencecount_wins(_enabled):
    """Among count=1 candidates: lower referenceCount (less generic) first."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed-slug", "playCount": 2,
                "minCreatedSlug": "set-a", "maxCreatedSlug": "set-a",
            }]
        }
    }
    audio = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": "generic", "artist": "Generic", "title": "Hit", "referenceCount": 50},
            {"slug": "rare", "artist": "Rare", "title": "Cut", "referenceCount": 5},
        ],
    }]}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/set-a", _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")

    assert [t.artist for t in results] == ["Rare", "Generic"]


async def test_seed_filtered_out_of_candidates(_enabled):
    """If the seed slug appears in the tracklist, it must NOT be returned."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed-slug", "playCount": 2,
                "minCreatedSlug": "set-a", "maxCreatedSlug": "set-a",
            }]
        }
    }
    audio = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": "seed-slug", "artist": "Nina Kraviz", "title": "Tarde", "referenceCount": 10},
            {"slug": "other", "artist": "Other", "title": "T", "referenceCount": 5},
        ],
    }]}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/set-a", _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")

    assert "seed-slug" not in {t.sourceUrl.rsplit("/", 1)[-1] for t in results}
    assert [t.artist for t in results] == ["Other"]


async def test_seed_filtered_when_present_multiple_times(_enabled):
    """A DJ playing the same seed twice — all instances must drop."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed-slug", "playCount": 2,
                "minCreatedSlug": "set-a", "maxCreatedSlug": "set-a",
            }]
        }
    }
    audio = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": "seed-slug", "artist": "Nina Kraviz", "title": "Tarde", "referenceCount": 10},
            {"slug": "seed-slug", "artist": "Nina Kraviz", "title": "Tarde", "referenceCount": 10},
            {"slug": "good", "artist": "Good", "title": "T", "referenceCount": 5},
        ],
    }]}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/set-a", _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")

    assert [t.artist for t in results] == ["Good"]


async def test_track_with_null_slug_skipped(_enabled):
    """Detection entries missing a slug are silently dropped."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed-slug", "playCount": 2,
                "minCreatedSlug": "set-a", "maxCreatedSlug": "set-a",
            }]
        }
    }
    audio = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": None, "artist": "NoSlug", "title": "Mystery", "referenceCount": 1},
            {"slug": "valid", "artist": "Valid", "title": "T", "referenceCount": 1},
        ],
    }]}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/set-a", _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")

    assert [t.artist for t in results] == ["Valid"]


async def test_audiostream_failure_is_soft(_enabled, capsys):
    """A failing audiostream fetch contributes nothing; partial pool returned."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed-slug", "playCount": 2,
                "minCreatedSlug": "set-a", "maxCreatedSlug": "set-b",
            }]
        }
    }
    set_b_audio = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": "x", "artist": "X", "title": "T", "referenceCount": 1},
        ],
    }]}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/set-a", httpx.ConnectError("set-a down")),
        ("/audiostreams/set-b", _resp(set_b_audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")

    assert [t.artist for t in results] == ["X"]
    assert "[Trackidnet]" in capsys.readouterr().out


async def test_empty_detection_processes_returns_empty_pool(_enabled):
    """Audiostream with no detectionProcesses contributes 0 candidates."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed-slug", "playCount": 2,
                "minCreatedSlug": "set-a", "maxCreatedSlug": "set-a",
            }]
        }
    }
    audio = {"result": {"detectionProcesses": []}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/set-a", _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        assert await adapter.find_similar("Nina Kraviz - Tarde") == []


async def test_limit_caps_returned_candidates(_enabled):
    """30 candidates from the pool, limit=5 → 5 returned."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed-slug", "playCount": 2,
                "minCreatedSlug": "set-a", "maxCreatedSlug": "set-a",
            }]
        }
    }
    audio = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": f"t-{i}", "artist": f"A{i}", "title": f"T{i}",
             "referenceCount": i + 1}
            for i in range(30)
        ],
    }]}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/set-a", _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde", limit=5)

    assert len(results) == 5


async def test_min_max_dedup_when_only_one_play(_enabled):
    """Track played in one set: min == max, so we fetch only one audiostream."""
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed-slug", "playCount": 1,
                "minCreatedSlug": "single-set", "maxCreatedSlug": "single-set",
            }]
        }
    }
    audio = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": "neighbour", "artist": "N", "title": "T", "referenceCount": 1},
        ],
    }]}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/single-set", _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        results = await adapter.find_similar("Nina Kraviz - Tarde")

    audiostream_calls = [c for c in client.calls if "/audiostreams/" in c]
    assert len(audiostream_calls) == 1
    assert results[0].score == 1.0


# ── TrackMeta mapping ─────────────────────────────────────────────────────

async def test_trackmeta_fields_populated_correctly(_enabled):
    adapter = TrackidnetAdapter()
    search = {
        "result": {
            "musicTracks": [{
                "id": 1, "artist": "Nina Kraviz", "title": "Tarde",
                "slug": "seed", "playCount": 2,
                "minCreatedSlug": "set-a", "maxCreatedSlug": "set-a",
            }]
        }
    }
    audio = {"result": {"detectionProcesses": [{
        "endDate": "2025-01-01T00:00:00Z",
        "detectionProcessMusicTracks": [
            {"slug": "heliobolus-forest-hunter", "artist": "Heliobolus",
             "title": "Forest Hunter", "label": "Amniote Editions",
             "referenceCount": 1},
        ],
    }]}}
    rules = [
        ("/musictracks", _resp(search)),
        ("/audiostreams/set-a", _resp(audio)),
    ]
    client = _ScriptedClient(rules)
    with _patch_client(client):
        (track,) = await adapter.find_similar("Nina Kraviz - Tarde")

    assert track.title == "Forest Hunter"
    assert track.artist == "Heliobolus"
    assert track.source == "trackidnet"
    assert track.sourceUrl == "https://trackid.net/musictracks/heliobolus-forest-hunter"
    assert track.bpm is None and track.key is None and track.energy is None


# ── random_techno_track ──────────────────────────────────────────────────

async def test_random_techno_track_returns_none():
    assert await TrackidnetAdapter().random_techno_track() is None
