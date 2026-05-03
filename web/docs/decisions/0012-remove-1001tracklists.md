# 0012 — Remove 1001tracklists adapter

**Date:** 2026-05-03
**Status:** Accepted

**Context:**
1001tracklists.com was added in Stage B as a DJ co-occurrence source
(commit 8314220 / instruction B2). The adapter scraped the seed track's
DJ-set list, fetched up to 20 sets, and emitted tracks within ±2
positions of the seed as similarity candidates. It shipped flag-disabled
(`settings.tracklist1001_enabled = False`) because the live
1001tracklists search endpoint is AJAX/CSRF-gated: plain `httpx` GET/POST
to `/search/index.php` returns the homepage, not search results, so the
seed-resolution step fails and the rest of the scrape never runs.

The verified path forward to make the search endpoint work was a
Playwright headless browser. That is a substantial new dependency:
Chromium binaries baked into the python-service container, +200 MB
image size, additional cold-start latency, and a third-party browser
that needs version-pinning and security updates. All of that overhead
was for one additional source whose marginal value, on top of trackid.net
(also DJ-set co-occurrence, with a non-AJAX search endpoint), was
uncertain.

The adapter, its cache table, helpers, tests, fixtures, and config flag
had been sitting in the codebase as dead-but-not-deleted weight for the
last few weeks of development.

**Decision:**
Remove the 1001tracklists adapter and everything that supports only it,
in one commit. Specifically:

- `python-service/app/adapters/tracklist1001.py` — adapter
- `python-service/tests/test_tracklist1001.py` — tests
- `python-service/tests/fixtures/tracklist1001/` — HTML fixtures
- `web/prisma/schema.prisma` — `TracklistCooccurrence` model
- `web/prisma/schema.prisma` — `cooccurrence1001tl` column on
  `CandidateFeatures` (the C3 reservation slot for this source)
- `python-service/app/core/db.py` — `fetch_cooccurrence` and
  `upsert_cooccurrence_batch` (1001TL-specific; trackid has its own
  helpers `fetch_trackid_cooccurrence` / `upsert_trackid_cooccurrence_batch`)
- `python-service/app/config.py` — `tracklist1001_enabled` flag
- `python-service/app/api/routes/similar.py` — import, instantiation,
  `_tracklist1001_safe` wrapper, fan-out gather slot, `SourceList` entry,
  `TRACKLIST1001_TIMEOUT` constant

Trackid.net is retained as the DJ-set co-occurrence source. It is also
flag-disabled (`trackidnet_enabled = False`) pending selector
verification per the TODO comments in `app/adapters/trackidnet.py`, but
its search endpoint is reachable with plain `httpx` so re-enabling it
does not require Playwright or any other heavy dependency.

**Consequences:**
- Positive: cleaner codebase. One fewer adapter to maintain, no dead code
  paths gated by `tracklist1001_enabled`, no cache table with zero
  rows occupying schema space.
- Positive: the eval is unaffected — the adapter shipped flag-disabled
  and contributed zero results. Removing dormant code is by definition
  a no-op on ranking, and the post-removal eval run confirms that.
- Negative: if we later need DJ co-occurrence beyond what trackid
  provides, this work can be revisited but starts from scratch (the
  deleted code and schema can be recovered from git history). Stage C3
  (co-occurrence features) now has only one source to join:
  `TrackidCooccurrence`. That is fine — Stage D can learn weights for
  one or many sources symmetrically, and adding a second source later
  is a schema-only migration.

**Alternatives considered:**
- Playwright integration to make the search endpoint work — rejected.
  Deployment cost (browser binaries, image size, additional security
  surface) too high for a single additional source whose marginal
  value over trackid is uncertain.
- Pay for 1001tracklists' commercial API — rejected. This is a
  personal project; ongoing API cost not budgeted.
- Leave the disabled adapter in place "just in case" — rejected. Dead
  code accumulates cognitive load, gives the impression of optionality
  that doesn't really exist (the adapter cannot be re-enabled by
  flipping the flag — the search parser would still hit the homepage),
  and complicates Stage C3 schema reasoning.

**Revisit when:**
- Trackid.net proves insufficient for DJ-set co-occurrence and a
  second source becomes load-bearing — at that point evaluate
  Playwright+1001TL vs alternative sources (e.g. Mixesdb, Setlist.fm
  if it ever covers DJ sets) on equal footing.
