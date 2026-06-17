"""Tests for POST /enrich.

Background fill route — web's enrichment-queue calls this fire-and-forget
after marking the search done. The route is a thin wrapper around
BeatportAdapter.enrich_tracks; we patch the module-level _beatport
instance and inspect both inputs and the merge behavior.
"""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app

# Fail-closed auth: the conftest autouse fixture sets this same secret on the
# settings object, so requests through the middleware pass.
client = TestClient(app, headers={"x-internal-auth": "test-secret"})


def _track(url: str, title: str = "T", artist: str = "A", bpm=None, key=None) -> dict:
    return {
        "title": title,
        "artist": artist,
        "source": "youtube_music",
        "sourceUrl": url,
        "bpm": bpm,
        "key": key,
    }


# ── happy path ───────────────────────────────────────────────────────────────

def test_enrich_returns_beatport_filled_tracks_in_order():
    """Each input track is replaced by enriched_map[sourceUrl] when present."""
    inputs = [_track("yt://1"), _track("yt://2"), _track("yt://3")]

    # Beatport returns enriched copies for #1 and #3 only; #2 stays as-is.
    enriched_1 = {**inputs[0], "bpm": 140.0, "key": "8A"}
    enriched_3 = {**inputs[2], "bpm": 132.0, "key": "5A"}

    from app.core.models import TrackMeta
    # enrich_tracks always returns every input (resolved or unchanged); #2 is
    # returned untouched (searched, no match).
    enrich_map = {
        "yt://1": TrackMeta(**enriched_1),
        "yt://2": TrackMeta(**inputs[1]),
        "yt://3": TrackMeta(**enriched_3),
    }

    with patch(
        "app.api.routes.enrich._beatport.enrich_tracks",
        new=AsyncMock(return_value=(enrich_map, set())),
    ) as mock_enrich:
        resp = client.post("/enrich", json={"tracks": inputs})

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["tracks"]) == 3
    # Order preserved; #1 and #3 filled, #2 untouched.
    assert body["tracks"][0]["bpm"] == 140.0
    assert body["tracks"][0]["key"] == "8A"
    assert body["tracks"][1]["bpm"] is None  # resolved but no data → returned as-is
    assert body["tracks"][2]["bpm"] == 132.0
    assert body["failed_urls"] == []

    mock_enrich.assert_awaited_once()


# ── empty / no-op ────────────────────────────────────────────────────────────

def test_enrich_empty_list_returns_empty_without_calling_beatport():
    """Guard at top of /enrich short-circuits on empty input."""
    mock_enrich = AsyncMock()
    with patch("app.api.routes.enrich._beatport.enrich_tracks", new=mock_enrich):
        resp = client.post("/enrich", json={"tracks": []})

    assert resp.status_code == 200
    assert resp.json() == {"tracks": [], "failed_urls": []}
    mock_enrich.assert_not_called()


# ── soft-degrade: beatport returns nothing ───────────────────────────────────

def test_enrich_keeps_input_when_beatport_returns_empty_map():
    """Beatport blocked / no candidates found → enrich_map empty → inputs preserved."""
    inputs = [_track("yt://1"), _track("yt://2")]
    with patch(
        "app.api.routes.enrich._beatport.enrich_tracks",
        new=AsyncMock(return_value=({}, set())),
    ):
        resp = client.post("/enrich", json={"tracks": inputs})

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["tracks"]) == 2
    for i, b in enumerate(body["tracks"]):
        assert b["sourceUrl"] == inputs[i]["sourceUrl"]
        assert b["bpm"] is None  # unchanged


def test_enrich_surfaces_failed_urls():
    """Transiently-failed sourceUrls are reported so the caller can retry them."""
    inputs = [_track("yt://1"), _track("yt://2")]

    from app.core.models import TrackMeta
    enrich_map = {"yt://1": TrackMeta(**inputs[0]), "yt://2": TrackMeta(**inputs[1])}
    with patch(
        "app.api.routes.enrich._beatport.enrich_tracks",
        new=AsyncMock(return_value=(enrich_map, {"yt://2"})),
    ):
        resp = client.post("/enrich", json={"tracks": inputs})

    assert resp.status_code == 200
    assert resp.json()["failed_urls"] == ["yt://2"]
