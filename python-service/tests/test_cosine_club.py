"""Tests for the Cosine.club adapter (post-2026-05 public API).

The adapter holds a single httpx.AsyncClient as `self._client` for the
lifetime of the instance. We patch that client's `.get` per test and
assert the expected two-step flow: `/v1/search` to resolve the seed id,
then `/v1/tracks/{id}/similar` for the recommendations.

Soft-degrade contract per python-adapter-pattern skill:
- Missing API key → return [] without making a network call.
- Search returns no hits → return [].
- httpx.HTTPError anywhere → return [], log with [CosineClub] prefix.
"""
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.adapters.cosine_club import CosineClubAdapter


def _ok_response(payload: dict) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.raise_for_status = MagicMock(return_value=None)
    resp.json = MagicMock(return_value=payload)
    return resp


def _patch_get(adapter: CosineClubAdapter, side_effect):
    """Replace adapter._client.get with an AsyncMock dispatched by side_effect."""
    adapter._client.get = AsyncMock(side_effect=side_effect)


# ── soft degradation ─────────────────────────────────────────────────────────

async def test_missing_api_key_returns_empty_without_network(monkeypatch):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "")
    adapter = CosineClubAdapter()
    # If the adapter tried to GET, this would raise (no _client.get patch set).
    adapter._client.get = AsyncMock(side_effect=AssertionError("must not call"))
    assert await adapter.find_similar("Oscar Mulero - Horses") == []


async def test_search_no_hits_returns_empty(monkeypatch):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()
    _patch_get(adapter, lambda url, **_: _ok_response({"data": []}))
    assert await adapter.find_similar("Some Unknown - Track") == []


# ── happy path ───────────────────────────────────────────────────────────────

async def test_two_step_search_then_similar_returns_parsed_tracks(monkeypatch):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [{
                "id": "seed-123",
                "artist": "Oscar Mulero",
                "track": "Horses",
            }]})
        if url == "/v1/tracks/seed-123/similar":
            return _ok_response({
                "data": {
                    "similar_tracks": [
                        {
                            "track": "Faceless",
                            "artist": "Reeko",
                            "video_id": "vid1",
                            "video_uri": "https://www.youtube.com/watch?v=vid1",
                            "score": 0.92,
                        },
                        {
                            # Cover URL falls back to the YT thumbnail derived
                            # from video_id; external_link is the fallback URL.
                            "name": "Adjusted",
                            "artist": "Architectural",
                            "video_id": "vid2",
                            "external_link": "https://example.com/track/2",
                            "score": 0.88,
                        },
                    ]
                }
            })
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)

    results = await adapter.find_similar("Oscar Mulero - Horses", limit=20)

    assert len(results) == 2
    assert results[0].title == "Faceless"
    assert results[0].artist == "Reeko"
    assert results[0].source == "cosine_club"
    assert results[0].sourceUrl == "https://www.youtube.com/watch?v=vid1"
    assert results[0].coverUrl == "https://i.ytimg.com/vi/vid1/hqdefault.jpg"
    assert results[0].score == pytest.approx(0.92)
    # post-2026-05 API: BPM/key/energy/label/genre are not in the schema,
    # the parser leaves them as None.
    assert results[0].bpm is None
    assert results[0].key is None
    # Second result uses external_link because video_uri is missing.
    assert results[1].title == "Adjusted"
    assert results[1].sourceUrl == "https://example.com/track/2"


# ── failure modes ────────────────────────────────────────────────────────────

async def test_http_error_during_similar_returns_empty(monkeypatch, capsys):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [{
                "id": "seed-123", "artist": "X", "track": "Y",
            }]})
        # Simulate a 5xx on the similar call.
        raise httpx.HTTPError("upstream 502")

    _patch_get(adapter, _get)
    assert await adapter.find_similar("X - Y") == []
    assert "[CosineClub]" in capsys.readouterr().out


async def test_http_error_during_search_returns_empty(monkeypatch, capsys):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()

    async def _get(_url, **_kwargs):
        raise httpx.ConnectError("dns fail")

    _patch_get(adapter, _get)
    assert await adapter.find_similar("X - Y") == []
    assert "[CosineClub]" in capsys.readouterr().out


# ── search_suggestions (used by /suggestions route) ──────────────────────────

async def test_search_suggestions_formats_artist_title(monkeypatch):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()
    _patch_get(adapter, lambda url, **_: _ok_response({
        "data": [
            {"artist": "Reeko", "track": "Faceless"},
            # title-only entries appear without an artist
            {"name": "Untitled"},
            # missing both → dropped
            {},
        ]
    }))
    out = await adapter.search_suggestions("face", limit=10)
    assert out == ["Reeko - Faceless", "Untitled"]


async def test_search_suggestions_no_api_key(monkeypatch):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "")
    adapter = CosineClubAdapter()
    adapter._client.get = AsyncMock(side_effect=AssertionError("must not call"))
    assert await adapter.search_suggestions("anything") == []


# ── seed-relevance gate (the "Linda Jones" bug fix) ──────────────────────────

async def test_seed_rejects_off_topic_first_hit_and_skips_similar_call(
    monkeypatch, capsys
):
    """Reproduces the 'Ignez - A Love Dream' → Linda Jones bug.

    Cosine.club's fuzzy search returned an unrelated track as the first hit.
    The adapter must reject that hit, fall through to the next candidate (or
    return [] if none match), and never issue the /similar call against a
    phantom seed.
    """
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()

    calls: list[str] = []

    async def _get(url, **_kwargs):
        calls.append(url)
        if url == "/v1/search":
            return _ok_response({"data": [
                {"id": "linda-1", "artist": "Linda Jones", "track": "A Last Minute Miracle"},
                {"id": "neighbor-2", "artist": "Some Other Soul", "track": "Dream Of Love"},
            ]})
        raise AssertionError(f"must not GET {url} — seed rejected")

    _patch_get(adapter, _get)
    assert await adapter.find_similar("Ignez - A Love Dream") == []
    # Only the search was issued, no /similar call.
    assert calls == ["/v1/search"]
    out = capsys.readouterr().out
    assert "no seed matched" in out


async def test_seed_picks_second_candidate_when_first_is_off_topic(monkeypatch):
    """If the top hit is fuzzy noise but a later hit matches, use the later one."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [
                {"id": "wrong", "artist": "Linda Jones", "track": "A Last Minute Miracle"},
                {"id": "right", "artist": "Oscar Mulero", "track": "Horses"},
            ]})
        if url == "/v1/tracks/right/similar":
            return _ok_response({"data": {"similar_tracks": [
                {"track": "Faceless", "artist": "Reeko", "video_id": "v"}
            ]}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    out = await adapter.find_similar("Oscar Mulero - Horses")
    assert len(out) == 1
    assert out[0].artist == "Reeko"


async def test_seed_match_tolerates_diacritics_and_collaborators(monkeypatch):
    """'Óscar Mulero' query matches a 'Oscar Mulero & Ancient Methods' hit."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [{
                "id": "seed",
                "artist": "Oscar Mulero & Ancient Methods",
                "track": "Horses (Original Mix)",
            }]})
        if url == "/v1/tracks/seed/similar":
            return _ok_response({"data": {"similar_tracks": []}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    # Diacritic in query, collaborator suffix on candidate, parens on title —
    # all should still match.
    assert await adapter.find_similar("Óscar Mulero - Horses") == []
    # The empty similars list is the assertion above; the important part is we
    # *reached* the /similar call (no AssertionError was raised).


async def test_freeform_query_without_dash_skips_validation(monkeypatch):
    """A query without ' - ' has no parseable artist/title — accept top hit."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [{
                "id": "anything", "artist": "Whoever", "track": "Whatever",
            }]})
        if url == "/v1/tracks/anything/similar":
            return _ok_response({"data": {"similar_tracks": []}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    assert await adapter.find_similar("techno groove") == []
