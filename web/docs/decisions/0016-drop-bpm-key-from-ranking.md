# 0016 — Drop BPM/key from ranking pipeline

**Date:** 2026-05-04
**Status:** Accepted

**Context:**
The pipeline carried BPM and Camelot key as ranking-affecting signals
in two places. First, the /similar route inferred a seed BPM and key
from the top Cosine.club results (and historically a Beatport fallback,
removed in ADR-0015) and persisted them on `SearchQuery.sourceBpm` /
`sourceKey`. Second, the web aggregator applied a hard BPM range filter
based on the user's `bpmMin` / `bpmMax` UI inputs before RRF fusion.

Stage F's premise is that each of the six active source adapters
(Cosine.club, YouTube Music, Bandcamp, Yandex Music, Last.fm,
trackid.net) is itself a recommender system trained on millions of
hours of listening or co-occurrence data. When the project layered a
hard BPM filter or a key-compatibility scoring step on top of those
adapters' outputs, it was second-guessing them with a much weaker
heuristic. Cosine's May 2026 API migration also stopped returning
BPM/key, so the seed-inference signal had been quietly drying up
anyway.

The hard BPM filter was particularly load-bearing as a *negative*
signal: tracks outside `bpmMin..bpmMax` were dropped silently before
they could appear. For DJ-mixing, this was useful; for discovery —
which is the project's stated goal — it cut off candidates that the
adapters had explicitly rated as similar.

**Decision:**
Drop BPM, key, and energy from the ranking pipeline entirely. The
fields stay populated as informational metadata on `Track` rows when a
source happens to provide them (Yandex sometimes does), but they are
no longer used to filter, sort, or score candidates.

Specifically:

- Removed `_extract_source_meta` from `python-service/app/api/routes/similar.py`,
  along with `source_bpm`, `source_key`, `source_energy` fields on
  `SimilarResponse` and the corresponding return-tuple slots in
  `_find_by_artist_and_track` / `_find_by_artist_only`. The
  Cosine-confidence flag that drove Phase 2 fallback decisions was
  preserved as a smaller `_cosine_is_confident` helper.
- Dropped `SearchQuery.sourceBpm` and `SearchQuery.sourceKey` columns
  via migration `20260504130424_remove_bpm_key_ranking`.
- Dropped `@@index([bpm])` on `Track`. The column itself stays — it's
  still stored when an adapter populates it, just no longer indexed
  for range scans.
- Removed the hard BPM range filter from `web/lib/aggregator.ts` and
  the corresponding `bpmMin` / `bpmMax` / `key` fields on
  `SearchFilters` and on the `/api/search` Zod request schema.
- Removed the BPM and Camelot Key inputs from `components/FilterPanel.tsx`.
  The Genre dropdown is kept as the only filter input.
- Removed the source-BPM / source-Key badge row from the search page UI.
- The `/features/extract` request now passes `seed_bpm` / `seed_key` /
  `seed_energy` as `null`. The Python feature-extraction route still
  accepts those fields and computes bpmDelta / keyCompat / energyDelta
  when given non-null seeds — kept for forward compatibility if a
  future stage reintroduces a BPM/key seed source.
- Tests covering the BPM filter behavior in `web/lib/aggregator.test.ts`
  and the `_extract_source_meta` tests in
  `python-service/tests/test_similar.py` were removed (replaced with a
  smaller suite covering the new `_cosine_is_confident` helper).

**Consequences:**
- Positive: discovery breadth widens. Searches return the candidates
  the source adapters actually surface, regardless of BPM/key
  compatibility with the seed. Underground-techno seeds in particular
  no longer get their long-tail Cosine matches dropped because
  Cosine returned no BPM/key for either side of the comparison.
- Positive: the `/similar` response shape gets two fewer optional
  fields and the aggregator loses one filter pass. The whole
  source-meta inference stack (`_extract_source_meta`, the persisted
  `sourceBpm` / `sourceKey` columns, the seed-BPM badge in the UI)
  can be deleted at once instead of half-living forever.
- Negative: DJ-mixing use cases that depended on the manual
  BPM-range filter lose that capability. If it's needed again, it
  comes back as a client-side filter on already-fused candidates,
  not as a hard filter that runs before fusion — the discovery /
  filtering split is the point.
- Negative: `CandidateFeatures.bpmDelta` / `keyCompat` / `energyDelta`
  become permanently null for new searches. Columns stay nullable so
  Stage D can read historical data and so a future BPM/key source
  can re-populate them without a schema change.

**Alternatives considered:**
- Soft sort: rank BPM-compatible tracks higher but don't drop the
  others. Rejected — soft sort is still a layer of project-side
  ranking on top of the adapters' outputs, and the user's stated
  preference is "trust the source adapters." A soft layer means we
  own a tuning knob (the soft-sort weight) without owning the data
  to tune it well.
- Keep the BPM filter but move it to a post-fusion client-side
  optional filter. Rejected for this commit — Stage F's scope is to
  remove the artificial constraints, not relocate them. A future
  stage can add a UI-side filter if the use case proves load-bearing.
