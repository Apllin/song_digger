# 0018 — Smoke + speed test strategy

**Date:** 2026-05-04
**Status:** Accepted

**Context:**
Stages D–F simplified the ranking pipeline (removed BPM/key, dropped
Beatport, removed `/random`, replaced artist-level dislike with
identity-match track-level filter). The remaining default test suite
is fast and offline — pure unit tests for adapters with mocked HTTP,
RRF math, normalization helpers, and feature math. It does not exercise:

- whether each adapter actually returns useful results against a live
  upstream;
- whether the full `/similar` fan-out integrates correctly across all
  six sources;
- whether `/api/search` end-to-end (Python fan-out → web fusion →
  Postgres persistence) returns useful tracks;
- whether the dislike filter actually removes a disliked identity from
  subsequent searches;
- per-stage latency, which is the dominant UX axis for this product.

CI for the project is deferred (Stage H). Without a smoke + speed
suite, the only way to catch "Yandex started rate-limiting us" or
"someone introduced a synchronous DB call in `/similar`" is by trying
the app manually. That doesn't scale beyond the current developer.

**Decision:**
Two opt-in test suites alongside the existing default unit tests.

- **Smoke suite.** One test per adapter against the live API using
  popular techno seeds (Mulero/Horses, de Witte/Apollo, Kraviz/Tarde,
  Plastikman/Spastik). Threshold: ≥1 result on at least 3 of 4 seeds
  (≥2 of 4 for Bandcamp and trackid, which scrape patchier catalogs).
  Plus integration-shape tests for `/similar`, `/api/search`,
  `/api/dislikes` CRUD, and aggregator behavior on crafted source
  lists. Adapters skip cleanly when their API key is unset; integration
  tests skip when the dev servers aren't running. Run with
  `pytest -m smoke` and `pnpm test:smoke`.

- **Speed suite.** Per-adapter, per-endpoint, and aggregator P95
  latency over 5–100 sequential runs (depending on the surface), each
  with a hard threshold. Plus a 10-concurrent `/similar` test that
  catches the regression "fan-out became serial" without doing real
  load testing. Run with `pytest -m speed` and `pnpm test:speed`.

Neither suite runs by default. `python-service/pytest.ini` has
`addopts = -m "not smoke and not speed"`; the web side excludes the
suite directories from `vitest.config.ts` and provides dedicated
`vitest.smoke.config.ts` and `vitest.speed.config.ts` instead. The
smoke and speed scripts wrap with `pnpm run with-env` so root-`.env`
values (`DATABASE_URL`, API keys) reach the test process.

Speed thresholds are starting calibrations. The DislikedTrack
findMany threshold was raised from the spec's 100ms to 250ms after
the first run measured P50≈110ms, P95≈210ms in dev — the dominant
cost is Postgres round-trip + Prisma hydration, not the SELECT itself.
The test file documents the rationale inline so a future tightener
sees why 250ms exists.

CI integration of either suite is explicitly out of scope here. That
belongs to Stage H — production prep — when we know which signals
matter enough to gate merges on.

**Consequences:**
- Positive: regressions in adapter latency, pipeline throughput, or
  source coverage are catchable by a single command per stage. The
  measured P50/P95 in the test file headers and console output gives
  a baseline that future runs compare against by eye.
- Positive: smoke tests provide ground-truth that real APIs work.
  Unit tests cover branches; smoke tests cover "is the upstream still
  alive at all". The Yandex 429 we hit during initial calibration is
  exactly the signal we wanted — silent without smoke.
- Positive: speed thresholds are committed in code, not lore. A drift
  conversation goes "the test fails at 250ms, was it tightened?" not
  "did this used to be faster?".
- Negative: smoke tests will fail when an upstream API is flaky.
  Accepted — a binary signal is the point. The pitfall guidance in
  this stage's design doc forbids retrying or relaxing assertions to
  paper over flake.
- Negative: speed tests must run sequentially. Vitest 4's
  `fileParallelism: false` + `maxWorkers: 1` enforce this on the web
  side; pytest serial-by-default suffices on the Python side.
  Concurrent runs would make latency measurements meaningless.
- Negative: a developer with no API keys configured will see the
  adapter smoke tests skip rather than warn. Acceptable for now —
  the per-key skip is the right behavior in dev, and Stage H CI will
  set the keys explicitly.

**Alternatives considered:**
- Single combined suite with no markers — rejected. Mixing live
  network + offline unit tests in one pytest run means upstream
  flake breaks the regular test loop.
- pytest-benchmark for the speed suite — rejected. Heavyweight
  (statistical reporting, baselines we don't need yet) for a use
  case that just wants "P95 under threshold". `time.monotonic()`
  + sorted-list P95 covers it in 30 lines.
- Mocking the adapters in smoke tests — rejected. Mocked smoke
  isn't smoke; the whole value is hitting real upstreams. Mocked
  versions of these tests already exist as the unit suite.
- Inline `pytest.mark.skipif` per environment instead of marker
  selection — rejected. The marker approach lets a future Stage H
  CI workflow run `pytest -m smoke` on a schedule without changing
  the tests themselves.
