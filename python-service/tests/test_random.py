"""Tests for GET /random.

Hedged-request pattern: both sources (YTM, Yandex) start simultaneously
via asyncio.gather. The first non-None TrackMeta in priority order
(YTM > Yandex) wins. All-None or all-error returns 503.

Patches the module-level adapter instances rather than going through
the real adapters, mirroring the test_features_endpoint.py pattern.
"""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.models import TrackMeta
from app.main import app

client = TestClient(app)


def _make_track(source: str, video_id: str = "vid", title: str = "T") -> TrackMeta:
    return TrackMeta(
        title=title,
        artist="A",
        source=source,
        sourceUrl=f"{source}://{video_id}",
    )


def _patch_sources(ytm=None, yandex=None):
    """Convenience: patch the two module-level adapters' random_techno_track.
    Pass a TrackMeta, None, or an exception (instance or class) as side_effect."""
    def _to_mock(value):
        m = AsyncMock()
        if isinstance(value, BaseException) or (isinstance(value, type) and issubclass(value, BaseException)):
            m.side_effect = value
        else:
            m.return_value = value
        return m

    return [
        patch("app.api.routes.random._ytm.random_techno_track", new=_to_mock(ytm)),
        patch("app.api.routes.random._yandex.random_techno_track", new=_to_mock(yandex)),
    ]


# ── happy path: priority order ───────────────────────────────────────────────

def test_random_returns_ytm_when_both_succeed():
    """Both return a track → YTM wins (priority 1)."""
    yt = _make_track("youtube_music")
    yx = _make_track("yandex_music")

    patches = _patch_sources(ytm=yt, yandex=yx)
    with patches[0], patches[1]:
        resp = client.get("/random")

    assert resp.status_code == 200
    assert resp.json()["source"] == "youtube_music"


def test_random_falls_back_to_yandex_when_ytm_returns_none():
    yx = _make_track("yandex_music", title="Yandex Track")

    patches = _patch_sources(ytm=None, yandex=yx)
    with patches[0], patches[1]:
        resp = client.get("/random")

    assert resp.status_code == 200
    assert resp.json()["source"] == "yandex_music"
    assert resp.json()["title"] == "Yandex Track"


# ── all-none / errors ────────────────────────────────────────────────────────

def test_random_returns_503_when_all_sources_return_none():
    patches = _patch_sources(ytm=None, yandex=None)
    with patches[0], patches[1]:
        resp = client.get("/random")

    assert resp.status_code == 503
    assert "No random track" in resp.json()["detail"]


def test_random_skips_exceptions_and_returns_first_success():
    """YTM raises, Yandex returns a track → Yandex wins."""
    yx = _make_track("yandex_music")

    patches = _patch_sources(
        ytm=RuntimeError("ytm blocked"),
        yandex=yx,
    )
    with patches[0], patches[1]:
        resp = client.get("/random")

    assert resp.status_code == 200
    assert resp.json()["source"] == "yandex_music"


def test_random_returns_503_when_all_sources_raise():
    patches = _patch_sources(
        ytm=RuntimeError("a"),
        yandex=RuntimeError("b"),
    )
    with patches[0], patches[1]:
        resp = client.get("/random")

    assert resp.status_code == 503
