"""Smoke tests for each adapter against live external services.

These hit the real APIs with popular techno seeds. They're slow (a few
seconds per adapter on a cold cache, longer for trackid.net) and can
flake when an upstream service has an outage — that's acceptable for
this suite, which exists to catch real breakage.

Each adapter test:
- Skips if its API key is missing (soft-degrade is the default state in
  local dev without credentials).
- Asserts ≥1 result for at least 3 of the 4 popular seeds. Why 3/4 and
  not 4/4: even popular seeds occasionally miss in a single source's
  catalog. 3-of-4 catches "this adapter is broken" while tolerating
  catalog gaps.

Run with:  pytest -m smoke tests/smoke/test_adapter_smoke.py
"""
import pytest

from app.adapters.cosine_club import CosineClubAdapter
from app.adapters.lastfm import LastfmAdapter
from app.adapters.trackidnet import TrackidnetAdapter
from app.adapters.yandex_music import YandexMusicAdapter
from app.adapters.youtube_music import YouTubeMusicAdapter
from app.config import settings

pytestmark = pytest.mark.smoke

MIN_HITS_THRESHOLD = 3  # ≥1 result for at least this many of 4 seeds


async def _run_seeds(adapter, seed_queries: list[str]) -> dict[str, int]:
    """Return {query: result_count}; result_count==0 means the adapter
    returned an empty list (or raised — adapters swallow exceptions and
    return [] per the python-adapter-pattern)."""
    counts: dict[str, int] = {}
    for q in seed_queries:
        results = await adapter.find_similar(q, 30)
        counts[q] = len(results)
    return counts


def _hits(counts: dict[str, int]) -> int:
    return sum(1 for n in counts.values() if n > 0)


# ── Cosine.club ───────────────────────────────────────────────────────────────

async def test_cosine_smoke(popular_seed_queries):
    if not settings.cosine_club_api_key:
        pytest.skip("COSINE_CLUB_API_KEY not configured")
    counts = await _run_seeds(CosineClubAdapter(), popular_seed_queries)
    print(f"\n[Cosine smoke] {counts}")
    assert _hits(counts) >= MIN_HITS_THRESHOLD, (
        f"Cosine returned 0 results on too many seeds: {counts}"
    )


# ── YouTube Music (no API key required — uses ytmusicapi public web) ─────────

async def test_youtube_music_smoke(popular_seed_queries):
    counts = await _run_seeds(YouTubeMusicAdapter(), popular_seed_queries)
    print(f"\n[YTM smoke] {counts}")
    assert _hits(counts) >= MIN_HITS_THRESHOLD, (
        f"YouTube Music returned 0 results on too many seeds: {counts}"
    )


# ── Yandex Music ──────────────────────────────────────────────────────────────

async def test_yandex_music_smoke(popular_seed_queries):
    if not settings.yandex_music_token:
        pytest.skip("YANDEX_MUSIC_TOKEN not configured")
    counts = await _run_seeds(YandexMusicAdapter(), popular_seed_queries)
    print(f"\n[Yandex smoke] {counts}")
    assert _hits(counts) >= MIN_HITS_THRESHOLD, (
        f"Yandex returned 0 results on too many seeds: {counts}"
    )


# ── Last.fm ───────────────────────────────────────────────────────────────────

async def test_lastfm_smoke(popular_seed_queries):
    if not settings.lastfm_api_key:
        pytest.skip("LASTFM_API_KEY not configured")
    counts = await _run_seeds(LastfmAdapter(), popular_seed_queries)
    print(f"\n[Last.fm smoke] {counts}")
    assert _hits(counts) >= MIN_HITS_THRESHOLD, (
        f"Last.fm returned 0 results on too many seeds: {counts}"
    )


# ── trackid.net ───────────────────────────────────────────────────────────────

async def test_trackidnet_smoke(popular_seed_queries):
    if not settings.trackidnet_enabled:
        pytest.skip("TRACKIDNET_ENABLED=false")
    counts = await _run_seeds(TrackidnetAdapter(), popular_seed_queries)
    print(f"\n[Trackid smoke] {counts}")
    # Trackid relies on co-occurrence in DJ playlist tracklists, which is
    # patchier for individual tracks. 2/4 is acceptable here — the test
    # exists to catch "site down / parser broken", not catalog coverage.
    assert _hits(counts) >= 2, (
        f"Trackid returned 0 results on too many seeds: {counts}"
    )


# ── TrackMeta shape sanity ────────────────────────────────────────────────────

async def test_returned_tracks_have_required_fields(popular_seed_queries):
    """Verify every adapter returns TrackMeta objects with the fields
    downstream RRF/persistence requires (artist, title, source, sourceUrl).
    Spot-checks one seed against every adapter that responds."""
    seed = popular_seed_queries[0]
    adapters = [
        ("youtube_music", YouTubeMusicAdapter()),
    ]
    if settings.cosine_club_api_key:
        adapters.append(("cosine_club", CosineClubAdapter()))
    if settings.yandex_music_token:
        adapters.append(("yandex_music", YandexMusicAdapter()))
    if settings.lastfm_api_key:
        adapters.append(("lastfm", LastfmAdapter()))
    if settings.trackidnet_enabled:
        adapters.append(("trackidnet", TrackidnetAdapter()))

    for source_name, adapter in adapters:
        results = await adapter.find_similar(seed, 10)
        if not results:
            continue  # smoke-failure for this source is asserted in the per-adapter test
        for t in results[:3]:
            assert t.artist, f"{source_name}: empty artist on {t}"
            assert t.title, f"{source_name}: empty title on {t}"
            assert t.source == source_name, (
                f"{source_name}: track.source={t.source!r}, expected {source_name!r}"
            )
            assert t.sourceUrl.startswith("http"), (
                f"{source_name}: bad sourceUrl {t.sourceUrl!r}"
            )
