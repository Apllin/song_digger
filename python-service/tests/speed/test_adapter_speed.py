"""Per-adapter latency tests.

Each test runs `find_similar` 5 times against the speed-test seed
(Oscar Mulero - Horses) and asserts P95 (≈ max for 5 runs) under a
hard threshold. Print P50 + P95 for observability — when a threshold
gets tight, the printed numbers help diagnose whether the upstream
got slower or our code regressed.

Thresholds are starting points, calibrated below to give ~2x headroom
over typical warm-cache numbers in dev. They're not aspirational
floors; if observed P95 is consistently 10x below threshold, tighten.

Run with:  pytest -m speed tests/speed/test_adapter_speed.py
"""
import pytest

from app.adapters.cosine_club import CosineClubAdapter
from app.adapters.lastfm import LastfmAdapter
from app.adapters.trackidnet import TrackidnetAdapter
from app.adapters.yandex_music import YandexMusicAdapter
from app.adapters.youtube_music import YouTubeMusicAdapter
from app.config import settings

from .conftest import SPEED_SEED_QUERY, measure_runs, p50_p95

pytestmark = pytest.mark.speed


# Per-adapter P95 thresholds (seconds). Rationale:
# - Cosine: JSON API, two HTTP hops (search + similar). 3s leaves headroom
#   over the typical 0.5–1.5s warm-cache call.
# - YTM: ytmusicapi web scrape; radio fetch is slower than search. 5s.
# - Yandex: HTTPS API, occasional 429s. 5s.
# - Last.fm: fast JSON API; with artist fallback path it can chain two
#   calls so 8s is the looser bound.
# - Trackid: 1 search + 1 playlists-list + up to 15 detail fetches with
#   Semaphore(5). TRACKIDNET_TIMEOUT in similar.py is 25s; speed test
#   threshold matches.
COSINE_P95_S = 3.0
YTM_P95_S = 5.0
YANDEX_P95_S = 5.0
LASTFM_P95_S = 8.0
TRACKIDNET_P95_S = 25.0

RUNS = 5


def _report(name: str, latencies: list[float]) -> tuple[float, float]:
    p50, p95 = p50_p95(latencies)
    print(f"\n[{name} speed] P50={p50:.2f}s  P95={p95:.2f}s  runs={latencies}")
    return p50, p95


async def test_cosine_p95_latency():
    if not settings.cosine_club_api_key:
        pytest.skip("COSINE_CLUB_API_KEY not configured")
    adapter = CosineClubAdapter()
    latencies, _ = await measure_runs(
        lambda: adapter.find_similar(SPEED_SEED_QUERY, 30), runs=RUNS,
    )
    _, p95 = _report("Cosine", latencies)
    assert p95 < COSINE_P95_S, f"Cosine P95 {p95:.2f}s ≥ threshold {COSINE_P95_S}s"


async def test_youtube_music_p95_latency():
    adapter = YouTubeMusicAdapter()
    latencies, _ = await measure_runs(
        lambda: adapter.find_similar(SPEED_SEED_QUERY, 30), runs=RUNS,
    )
    _, p95 = _report("YTM", latencies)
    assert p95 < YTM_P95_S, f"YTM P95 {p95:.2f}s ≥ threshold {YTM_P95_S}s"


async def test_yandex_music_p95_latency():
    if not settings.yandex_music_token:
        pytest.skip("YANDEX_MUSIC_TOKEN not configured")
    adapter = YandexMusicAdapter()
    latencies, _ = await measure_runs(
        lambda: adapter.find_similar(SPEED_SEED_QUERY, 30), runs=RUNS,
    )
    _, p95 = _report("Yandex", latencies)
    assert p95 < YANDEX_P95_S, f"Yandex P95 {p95:.2f}s ≥ threshold {YANDEX_P95_S}s"


async def test_lastfm_p95_latency():
    if not settings.lastfm_api_key:
        pytest.skip("LASTFM_API_KEY not configured")
    adapter = LastfmAdapter()
    latencies, _ = await measure_runs(
        lambda: adapter.find_similar(SPEED_SEED_QUERY, 30), runs=RUNS,
    )
    _, p95 = _report("Last.fm", latencies)
    assert p95 < LASTFM_P95_S, f"Last.fm P95 {p95:.2f}s ≥ threshold {LASTFM_P95_S}s"


async def test_trackidnet_p95_latency():
    if not settings.trackidnet_enabled:
        pytest.skip("TRACKIDNET_ENABLED=false")
    adapter = TrackidnetAdapter()
    latencies, _ = await measure_runs(
        lambda: adapter.find_similar(SPEED_SEED_QUERY, 30), runs=RUNS,
    )
    _, p95 = _report("Trackid", latencies)
    assert p95 < TRACKIDNET_P95_S, (
        f"Trackid P95 {p95:.2f}s ≥ threshold {TRACKIDNET_P95_S}s"
    )
