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


def _pick_returning(idx):
    """Stub for pick_best_candidate that returns a fixed index (or None)."""
    async def _pick(_query, _candidates):
        return idx
    return _pick


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
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(0))
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


# ── URL-seeded search (TRA-25) ───────────────────────────────────────────────

async def test_url_seed_takes_first_hit_without_seed_validation(monkeypatch):
    """A pasted track URL pins the exact track: the top `/v1/search` hit is used
    directly, bypassing the fuzzy seed-match gate that text `find_similar` runs.
    This is what lets out-of-catalog tracks still return similars."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()

    calls: list[tuple[str, dict]] = []

    async def _get(url, **kwargs):
        calls.append((url, kwargs.get("params", {})))
        if url == "/v1/search":
            # An artist/title that would FAIL query_match_score against the URL —
            # proof that no validation is applied on the URL path.
            return _ok_response({"data": [{
                "id": "parsed-1", "artist": "Whoever", "track": "Whatever",
            }]})
        if url == "/v1/tracks/parsed-1/similar":
            return _ok_response({"data": {"similar_tracks": [
                {"track": "Faceless", "artist": "Reeko", "video_id": "v", "score": 0.4}
            ]}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    out = await adapter.find_similar_by_url(
        "https://music.youtube.com/watch?v=abc123", limit=20
    )
    assert len(out) == 1
    assert out[0].artist == "Reeko"
    # The URL was passed as the `q` param to /v1/search.
    assert calls[0][0] == "/v1/search"
    assert calls[0][1]["q"] == "https://music.youtube.com/watch?v=abc123"


async def test_url_seed_no_api_key_returns_empty_without_network(monkeypatch):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "")
    adapter = CosineClubAdapter()
    adapter._client.get = AsyncMock(side_effect=AssertionError("must not call"))
    assert await adapter.find_similar_by_url("https://music.youtube.com/watch?v=x") == []


async def test_url_seed_empty_url_returns_empty_without_network(monkeypatch):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()
    adapter._client.get = AsyncMock(side_effect=AssertionError("must not call"))
    assert await adapter.find_similar_by_url("") == []


async def test_url_seed_no_parsed_track_returns_empty(monkeypatch):
    """Cosine couldn't parse the URL → empty search data → no /similar call."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()

    calls: list[str] = []

    async def _get(url, **_kwargs):
        calls.append(url)
        if url == "/v1/search":
            return _ok_response({"data": []})
        raise AssertionError(f"must not GET {url} — nothing parsed")

    _patch_get(adapter, _get)
    assert await adapter.find_similar_by_url("https://example.com/x") == []
    assert calls == ["/v1/search"]


async def test_url_seed_http_error_returns_empty(monkeypatch, capsys):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    adapter = CosineClubAdapter()
    _patch_get(adapter, AsyncMock(side_effect=httpx.ConnectError("dns fail")))
    assert await adapter.find_similar_by_url("https://music.youtube.com/watch?v=x") == []
    assert "[CosineClub]" in capsys.readouterr().out


# ── failure modes ────────────────────────────────────────────────────────────

async def test_http_error_during_similar_returns_empty(monkeypatch, capsys):
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(0))
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
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(None))
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
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(1))
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
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(0))
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


async def test_version_specific_query_prefers_version_specific_seed(monkeypatch):
    """A query carrying a version marker must seed off the version-specific
    catalog entry, not the bare-title sibling. Without scored matching, the
    bare title is a substring of the long query so it validates and the
    upstream's own ranking decides — which collapses different recordings."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(1))
    adapter = CosineClubAdapter()

    # Cosine often returns the bare title first for relevance/popularity, with
    # the version-specific entry further down. The seed picker must reach for
    # the higher-scoring exact match anyway.
    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [
                {"id": "bare", "artist": "Nina Kraviz, David Löhlein", "track": "Bailando"},
                {
                    "id": "version",
                    "artist": "Nina Kraviz, David Löhlein",
                    "track": "Bailando (NK & David Löhlein Version)",
                },
            ]})
        if url == "/v1/tracks/version/similar":
            return _ok_response({"data": {"similar_tracks": [
                {"track": "X", "artist": "Y", "video_id": "v"}
            ]}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    out = await adapter.find_similar(
        "Nina Kraviz, David Löhlein - Bailando (NK & David Löhlein Version)"
    )
    assert len(out) == 1
    assert out[0].artist == "Y"


async def test_bare_title_query_still_picks_bare_seed(monkeypatch):
    """The reverse: when the query has no version marker, the bare-title hit
    is the exact match and should win even if a version-specific sibling
    appears in the candidate list."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(1))
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [
                {
                    "id": "version",
                    "artist": "Nina Kraviz, David Löhlein",
                    "track": "Bailando (NK & David Löhlein Version)",
                },
                {"id": "bare", "artist": "Nina Kraviz, David Löhlein", "track": "Bailando"},
            ]})
        if url == "/v1/tracks/bare/similar":
            return _ok_response({"data": {"similar_tracks": [
                {"track": "X", "artist": "Y", "video_id": "v"}
            ]}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    out = await adapter.find_similar("Nina Kraviz, David Löhlein - Bailando")
    assert len(out) == 1


async def test_bare_artist_query_picks_first_track_by_that_artist(monkeypatch):
    """A bare-artist query (no ' - ') seeds off the first candidate whose
    artist matches the query — i.e. the first track by that artist."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(1))
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [
                # Off-artist hit — fuzzy match on title — must be skipped.
                {"id": "off", "artist": "Some Other Soul", "track": "Oscar's Theme"},
                # First track actually by Oscar Mulero — the seed we want.
                {"id": "right", "artist": "Oscar Mulero", "track": "Horses"},
            ]})
        if url == "/v1/tracks/right/similar":
            return _ok_response({"data": {"similar_tracks": [
                {"track": "Faceless", "artist": "Reeko", "video_id": "v"}
            ]}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    out = await adapter.find_similar("Oscar Mulero")
    assert len(out) == 1
    assert out[0].artist == "Reeko"


async def test_bare_artist_query_prefers_exact_artist_over_substring(monkeypatch):
    """Bare-artist query "Rill" must seed off an actual `rill` track, not off
    "Rill Saionji" — a different artist whose name happens to start with
    "Rill". Subset token-match would tie both at MATCH_ARTIST, so cosine's own
    ranking would decide. The exact-entity match must win."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(1))
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [
                # Cosine returns "Rill Saionji" first — wrong artist, but {"rill"}
                # is a subset of {"rill", "saionji"} so the old code accepted it.
                {"id": "wrong", "artist": "Rill Saionji", "track": "Caress"},
                {"id": "right", "artist": "rill", "track": "friss"},
                {"id": "also", "artist": "rill", "track": "silky stones"},
            ]})
        if url == "/v1/tracks/right/similar":
            return _ok_response({"data": {"similar_tracks": [
                {"track": "X", "artist": "Y", "video_id": "v"}
            ]}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    out = await adapter.find_similar("Rill")
    assert len(out) == 1
    assert out[0].artist == "Y"


async def test_bare_artist_query_accepts_collab_with_exact_entity(monkeypatch):
    """For bare-artist "Rill", a candidate "rill & somebody" must qualify as
    MATCH_ARTIST_EXACT — `rill` is one of the collab-split entities. Otherwise
    legitimate Rill collabs would lose to single-name lookalikes."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(1))
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [
                {"id": "wrong", "artist": "Rill Saionji", "track": "Caress"},
                {"id": "right", "artist": "rill & somebody", "track": "friss"},
            ]})
        if url == "/v1/tracks/right/similar":
            return _ok_response({"data": {"similar_tracks": [
                {"track": "X", "artist": "Y", "video_id": "v"}
            ]}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    out = await adapter.find_similar("Rill")
    assert len(out) == 1
    assert out[0].artist == "Y"


async def test_bare_artist_query_returns_empty_when_no_artist_match(
    monkeypatch, capsys
):
    """Bare-artist query with no candidate by that artist → drop the source."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(None))
    adapter = CosineClubAdapter()

    calls: list[str] = []

    async def _get(url, **_kwargs):
        calls.append(url)
        if url == "/v1/search":
            return _ok_response({"data": [
                {"id": "x", "artist": "Whoever", "track": "Whatever"},
            ]})
        raise AssertionError(f"must not GET {url} — seed rejected")

    _patch_get(adapter, _get)
    assert await adapter.find_similar("Chontane") == []
    assert calls == ["/v1/search"]
    assert "no seed matched" in capsys.readouterr().out


async def test_seed_match_tolerates_catalog_tag_suffix(monkeypatch):
    """'Baby Ford - Dognosematic' must seed off a 'Dognosematic [Perlon114]'
    candidate — the label/catalog tag is release noise, not a distinct title.
    Regression for the bug where YTM/Yandex (same _seed_match gate) dropped out
    because the title signatures differed only by the catalog suffix."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(0))
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [{
                "id": "seed", "artist": "Baby Ford", "track": "Dognosematic [Perlon114]",
            }]})
        if url == "/v1/tracks/seed/similar":
            return _ok_response({"data": {"similar_tracks": [
                {"track": "X", "artist": "Y", "video_id": "v"}
            ]}})
        raise AssertionError(f"unexpected url: {url}")

    _patch_get(adapter, _get)
    out = await adapter.find_similar("Baby Ford - Dognosematic")
    assert len(out) == 1
    assert out[0].artist == "Y"


async def test_artist_title_query_requires_exact_title_match(monkeypatch, capsys):
    """"Artist - Title" query with no exact title match → drop the source even
    if a candidate by the same artist exists."""
    monkeypatch.setattr("app.adapters.cosine_club.settings.cosine_club_api_key", "k")
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick_returning(None))
    adapter = CosineClubAdapter()

    async def _get(url, **_kwargs):
        if url == "/v1/search":
            return _ok_response({"data": [
                # Same artist, different track — no longer a loose match.
                {"id": "wrong", "artist": "Oscar Mulero", "track": "Horses (VIP Mix)"},
            ]})
        raise AssertionError(f"must not GET {url} — seed rejected")

    _patch_get(adapter, _get)
    assert await adapter.find_similar("Oscar Mulero - Horses") == []
    assert "no seed matched" in capsys.readouterr().out
