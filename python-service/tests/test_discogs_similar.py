"""Tests for the Discogs collaborative source (find_similar / build_collaborative).

find_similar is a warm-cache read; build_collaborative is the offline build that
samples Have/Want collectors and matches their collections by direct style
overlap with the seed. Real HTTP and the Cloudflare-gated stats fetch are mocked.
"""
from unittest.mock import AsyncMock

import pytest

from app.adapters import discogs as discogs_mod
from app.adapters.discogs import (
    DiscogsAdapter,
    _parse_stats_usernames,
)
from app.config import settings


def _make_resp(json_data: dict) -> AsyncMock:
    resp = AsyncMock()
    resp.status_code = 200
    resp.json = lambda: json_data
    resp.headers = {}
    resp.raise_for_status = lambda: None
    return resp


def _item(rid: int, title: str, styles: list[str], artist: str = "Some Artist") -> dict:
    return {
        "basic_information": {
            "id": rid,
            "title": title,
            "artists": [{"name": artist}],
            "labels": [{"name": "A Label"}],
            "styles": styles,
            "genres": ["Electronic"],
            "cover_image": f"http://img/{rid}.jpg",
        }
    }


@pytest.fixture
def adapter(monkeypatch) -> DiscogsAdapter:
    monkeypatch.setattr(settings, "discogs_token", "test-token")
    # Neutralize the cache layer by default; individual tests override.
    monkeypatch.setattr(discogs_mod, "fetch_external_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(discogs_mod, "upsert_external_cache", AsyncMock(return_value=None))
    return DiscogsAdapter()


# ── find_similar (hot path: cache read only) ─────────────────────────────────


async def test_find_similar_soft_degrades_without_token(monkeypatch):
    monkeypatch.setattr(settings, "discogs_token", "")
    adapter = DiscogsAdapter()
    assert await adapter.find_similar("Joe Milli - Repetitions EP", 9) == []


async def test_find_similar_returns_empty_on_cache_miss(adapter, monkeypatch):
    monkeypatch.setattr(discogs_mod, "fetch_external_cache", AsyncMock(return_value=None))
    assert await adapter.find_similar("Joe Milli - Repetitions EP", 9) == []


async def test_find_similar_returns_cached_tracks_capped(adapter, monkeypatch):
    payload = [
        {"title": f"T{i}", "artist": "X", "source": "discogs",
         "sourceUrl": f"https://www.discogs.com/release/{i}"}
        for i in range(5)
    ]
    monkeypatch.setattr(discogs_mod, "fetch_external_cache", AsyncMock(return_value=payload))
    out = await adapter.find_similar("Joe Milli - Repetitions EP", limit=3)
    assert len(out) == 3
    assert all(t.source == "discogs" for t in out)
    assert out[0].sourceUrl == "https://www.discogs.com/release/0"


# ── build_collaborative (offline build) ──────────────────────────────────────


async def test_build_soft_degrades_without_token(monkeypatch):
    monkeypatch.setattr(settings, "discogs_token", "")
    adapter = DiscogsAdapter()
    assert await adapter.build_collaborative("Joe Milli - Repetitions EP") == []


# ── seed resolution (track-aware) ────────────────────────────────────────────


async def test_resolve_seed_searches_by_track_param(adapter):
    captured: dict = {}

    def _route(path, **kwargs):
        captured.update(kwargs.get("params", {}))
        return _make_resp({"results": [{"id": 111, "style": ["Techno"], "genre": ["Electronic"]}]})

    adapter._client.get = AsyncMock(side_effect=_route)
    rid, styles, _ = await adapter._resolve_seed("Joe Milli", "Retreat")
    assert rid == 111
    assert captured.get("artist") == "Joe Milli"
    assert captured.get("track") == "Retreat"   # track title, not q
    assert "q" not in captured
    assert styles == {"techno"}


async def test_resolve_seed_falls_back_to_release_title(adapter):
    calls: list[dict] = []

    def _route(path, **kwargs):
        params = kwargs.get("params", {})
        calls.append(params)
        if "track" in params:                    # 1st attempt: no track match
            return _make_resp({"results": []})
        return _make_resp({"results": [{"id": 222, "style": ["House"], "genre": ["Electronic"]}]})

    adapter._client.get = AsyncMock(side_effect=_route)
    rid, _, _ = await adapter._resolve_seed("Joe Milli", "Repetitions EP")
    assert rid == 222
    assert len(calls) == 2
    assert "release_title" in calls[1]


async def test_build_returns_empty_when_seed_not_found(adapter):
    adapter._client.get = AsyncMock(return_value=_make_resp({"results": []}))
    assert await adapter.build_collaborative("Nonexistent - Track") == []


async def test_build_returns_empty_without_owners(adapter, monkeypatch):
    # Seed resolves, but no unblocker → no collectors → nothing to sample.
    # Force the unblocker empty so the test is independent of the ambient .env.
    monkeypatch.setattr(settings, "discogs_stats_unblocker_url", "")
    adapter._client.get = AsyncMock(
        return_value=_make_resp({"results": [{"id": 111, "style": ["Techno"], "genre": ["Electronic"]}]})
    )
    assert await adapter.build_collaborative("Joe Milli - Repetitions EP") == []


async def test_build_style_match_caps_and_dedup(adapter):
    adapter._fetch_release_users = AsyncMock(return_value={"have": ["alice", "bob"], "want": ["carol"]})

    def _route(path, **kwargs):
        if path == "/database/search":
            return _make_resp({"results": [{"id": 111, "style": ["Techno", "Dub Techno"], "genre": ["Electronic"]}]})
        if path.startswith("/users/alice/collection"):
            return _make_resp({"releases": [
                _item(111, "Seed EP", ["Techno"]),          # the seed → excluded
                _item(222, "Match A", ["Techno"]),          # match
                _item(333, "Rap Thing", ["Hip Hop"]),       # off-style → skip
                _item(444, "Match B", ["Dub Techno", "Ambient"]),  # shares Dub Techno → match
                _item(555, "Match C", ["Techno"]),          # match → caps alice at 3
                _item(666, "Match D", ["Techno"]),          # never reached (per-user cap)
            ]})
        if path.startswith("/users/bob/collection"):
            return _make_resp({"releases": [
                _item(222, "Match A dup", ["Techno"]),      # dup across users → deduped
                _item(777, "Match E", ["Techno"]),          # match
            ]})
        if path.startswith("/users/carol/collection"):
            return _make_resp({"releases": [_item(888, "Match F", ["Techno"])]})
        raise AssertionError(f"unexpected path {path}")

    adapter._client.get = AsyncMock(side_effect=_route)

    out = await adapter.build_collaborative("Joe Milli - Repetitions EP", limit=9)
    urls = [t.sourceUrl for t in out]

    assert all(t.source == "discogs" for t in out)
    # 3 collectors sampled (_COLLAB_MAX_USERS). alice: 222,444,555 (per-user cap 3);
    # bob: 777 (222 deduped); carol: 888.
    assert urls == [
        "https://www.discogs.com/release/222",
        "https://www.discogs.com/release/444",
        "https://www.discogs.com/release/555",
        "https://www.discogs.com/release/777",
        "https://www.discogs.com/release/888",
    ]
    assert "https://www.discogs.com/release/111" not in urls  # seed excluded
    # mapping sanity
    assert out[0].title == "Match A"
    assert out[0].label == "A Label"
    assert out[0].genre == "Techno"


# ── style matching (direct 1-1 overlap, no families / broadening) ─────────────


async def test_build_matches_only_shared_style(adapter):
    # A House seed matches only candidates that themselves carry "House" —
    # related-but-distinct styles (Deep House, Techno) do NOT match anymore.
    adapter._fetch_release_users = AsyncMock(return_value={"have": ["alice"], "want": []})

    def _route(path, **kwargs):
        if path == "/database/search":
            return _make_resp({"results": [{"id": 1, "style": ["House"], "genre": ["Electronic"]}]})
        return _make_resp({"releases": [
            _item(10, "House thing", ["House"]),        # exact style → match
            _item(20, "Deep thing", ["Deep House"]),    # different tag → skip
            _item(30, "Techno thing", ["Techno"]),      # different tag → skip
        ]})

    adapter._client.get = AsyncMock(side_effect=_route)
    urls = [t.sourceUrl for t in await adapter.build_collaborative("X - Y", limit=9)]
    assert "https://www.discogs.com/release/10" in urls
    assert "https://www.discogs.com/release/20" not in urls
    assert "https://www.discogs.com/release/30" not in urls


async def test_build_genre_fallback_when_seed_has_no_styles(adapter):
    # No seed styles → fall back to direct genre overlap.
    adapter._fetch_release_users = AsyncMock(return_value={"have": ["alice"], "want": []})

    def _route(path, **kwargs):
        if path == "/database/search":
            return _make_resp({"results": [{"id": 1, "style": [], "genre": ["Electronic"]}]})
        return _make_resp({"releases": [
            _item(10, "Elec thing", []),                # genre Electronic (from _item) → match
            {"basic_information": {"id": 20, "title": "Rock thing",
                                   "artists": [{"name": "X"}], "styles": [], "genres": ["Rock"]}},
        ]})

    adapter._client.get = AsyncMock(side_effect=_route)
    urls = [t.sourceUrl for t in await adapter.build_collaborative("X - Y", limit=9)]
    assert "https://www.discogs.com/release/10" in urls
    assert "https://www.discogs.com/release/20" not in urls


async def test_build_respects_output_limit(adapter):
    adapter._fetch_release_users = AsyncMock(return_value={"have": ["alice"], "want": []})

    def _route(path, **kwargs):
        if path == "/database/search":
            return _make_resp({"results": [{"id": 1, "style": ["Techno"], "genre": ["Electronic"]}]})
        return _make_resp({"releases": [_item(10, "A", ["Techno"]), _item(20, "B", ["Techno"]), _item(30, "C", ["Techno"])]})

    adapter._client.get = AsyncMock(side_effect=_route)
    out = await adapter.build_collaborative("Joe Milli - Repetitions EP", limit=2)
    assert len(out) == 2


# ── stats-page parsing ───────────────────────────────────────────────────────


# Trimmed from the real /ru/release/stats/37505337 DOM: three groups in order
# (Ratings, Have, Want), localized RU headings, usernames in linked_username.
def _stats_group(heading: str, usernames: list[str]) -> str:
    items = "".join(
        f'<li><span class="user"><span class="user_thumbnail_with_username">'
        f'<a href="/ru/user/{u}"><span class="linked_username">{u}</span></a>'
        f"</span></span></li>"
        for u in usernames
    )
    return (
        f'<div class="release_stats_group"><h2>{heading}</h2>'
        f'<div class="release_stats_group_list"><ul role="list">{items}</ul></div></div>'
    )


_REAL_STATS_HTML = (
    _stats_group("2 Оценок", ["heliosphaner", "hpjm"])
    + _stats_group("12 есть у участников", ["jjx303", "NachoNowacki", "Q-Sub", "Wills-wax"])
    + _stats_group(
        "14 в списке желаемого у участников",
        ["allypal1", "B.Vinyl_Mitte", "DarkoEsser", "no___drift", "Pierre-Alexis"],
    )
)


def test_parse_stats_usernames_classifies_three_groups():
    out = _parse_stats_usernames(_REAL_STATS_HTML)
    # Ratings group (heliosphaner, hpjm) must NOT leak into have.
    assert out["have"] == ["jjx303", "NachoNowacki", "Q-Sub", "Wills-wax"]
    assert out["want"] == ["allypal1", "B.Vinyl_Mitte", "DarkoEsser", "no___drift", "Pierre-Alexis"]


def test_parse_stats_usernames_handles_english_headings():
    html = _stats_group("12 Have", ["alice"]) + _stats_group("14 Want", ["bob"])
    out = _parse_stats_usernames(html)
    assert out["have"] == ["alice"]
    assert out["want"] == ["bob"]


def test_parse_stats_usernames_empty_without_groups():
    assert _parse_stats_usernames("<div>no groups here</div>") == {"have": [], "want": []}
