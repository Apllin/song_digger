# 0015 — Remove Beatport adapter

**Date:** 2026-05-04
**Status:** Accepted

**Context:**
Beatport was added early in the project as the primary source of audio
metadata — BPM and Camelot key extracted from `__NEXT_DATA__` JSON
embedded in Beatport HTML pages. Two consumers used the data:

1. The /similar route's Phase 2 fallback inferred a seed BPM/key from
   Beatport when Cosine.club's confidence was low.
2. The /enrich route + `web/lib/enrichment-queue.ts` ran a
   fire-and-forget background fill that scraped Beatport for BPM/key on
   tracks that didn't fit the INLINE_BUDGET (top 6) on the user-visible
   response.

Both consumers were ultimately feeding the BPM/key fields used by the
hard BPM range filter and the BPM-related ranking signals. Stage F
(this stage) removes those filters and signals: candidate fusion now
trusts each source adapter's own ranking instead of post-filtering on
audio features. With BPM/key gone from ranking, Beatport scraping has
no remaining purpose — the data is only displayed as informational
badges in the UI when a source happens to provide it.

Beatport was also the only adapter that scraped HTML rather than
calling a JSON API, which made it the slowest member of the /similar
fan-out and the most fragile (every Beatport page redesign broke
parsing). Cosine.club's API migration in May 2026 already dropped its
own BPM/key returns, so even the inline gap-fill no longer had a
useful upstream signal to fill against.

**Decision:**
Remove the Beatport adapter and everything that supports only it, in
one commit, before Stage F's BPM/key removal in the next commit:

- `python-service/app/adapters/beatport.py` — adapter
- `python-service/tests/test_beatport.py` — tests
- `python-service/app/api/routes/enrich.py` — Beatport-only background
  enrichment route
- `python-service/tests/test_enrich.py` — tests
- `python-service/app/main.py` — `enrich_router` import + mount
- `python-service/app/api/routes/similar.py` — `BeatportAdapter` import,
  `_beatport` instance, Phase 2 `find_similar` fallback for seed BPM/key,
  the `INLINE_BUDGET` / `ENRICH_CONCURRENCY` constants, and the inline
  enrichment block at the end of the route
- `python-service/app/api/routes/random.py` — `_beatport` from the
  hedged-request fan-out (`random.py` itself stays through Step 3)
- `python-service/tests/test_random.py` — Beatport patches and the
  Beatport-priority assertion
- `python-service/tests/test_regression.py` — `_beatport.find_similar`
  patches in the Cosine-DNS-failure regression tests
- `web/lib/enrichment-queue.ts` — file deleted
- `web/lib/python-client.ts` — `enrichTracks()` function
- `web/app/api/search/route.ts` — `enqueueBackgroundEnrich` import,
  `INLINE_BUDGET` constant, and the background-enrich block in `runSearch`

**Consequences:**
- Positive: one fewer HTML-scraping adapter to keep alive against
  upstream redesigns. The /similar fan-out drops Phase 2's
  Beatport gather slot, marginally tightening the slow-path latency
  envelope on low-confidence Cosine searches.
- Positive: the /enrich route, `enrichment-queue.ts`, and the inline
  enrichment loop in /similar all disappear together — three
  Beatport-shaped abstractions collapse out of the pipeline at once.
- Negative: tracks that only Beatport knew the BPM/key for will no
  longer get those fields populated on new searches. Existing rows in
  `Track` keep whatever BPM/key was previously written. Stage F's next
  commit (ADR-0016) drops BPM/key from ranking entirely, so this loss
  has no effect on result quality.
- Negative: `CandidateFeatures.bpmDelta`, `keyCompat`, `energyDelta`
  become permanently null for new searches. Columns are kept nullable
  for historical data; if BPM/key is ever reintroduced via another
  source, Stage D can read them again.

**Alternatives considered:**
- Keep Beatport solely for the UI badge. Rejected — the BPM/key fields
  are also populated by Cosine.club (when its API returns them) and the
  per-track adapter (Yandex sometimes carries them). The marginal UI
  benefit of Beatport-only fills did not justify maintaining the
  scraper. Cosine's May 2026 API migration also stopped returning
  BPM/key, so the gap-fill signal was already drying up.
- Keep Beatport as a future enrichment source for a later Stage D
  feature. Rejected — re-adding the adapter from git history takes an
  hour if it ever becomes load-bearing again, and dead code carries
  ongoing maintenance overhead (proxy issues, page redesigns, the
  `__NEXT_DATA__` selector breaking) that the project is not paying
  attention to today.

**Revisit when:**
- A future Stage reintroduces BPM/key as a ranking signal AND no
  active source (Cosine, Yandex, per-source adapters) reliably
  populates the field. At that point evaluate Beatport vs Spotify
  Audio Features API vs another source on equal footing rather than
  defaulting back to Beatport.
