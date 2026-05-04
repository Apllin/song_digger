# 0011 — Feature vector schema for learned ranking

**Date:** 2026-05-03
**Status:** Accepted (2026-05-03)
**Superseded by [ADR-0019](0019-remove-feature-extraction.md) (2026-05-04)**

**Context:**
RRF (ADR-0003) ranks candidates by source-list rank position only. It is
deliberately ignorant of metadata signals that the system already has —
BPM/key/energy proximity, label match, source agreement, embed availability,
co-occurrence counts from the cache tables. These weak-on-their-own signals
combine usefully when given a chance to learn weights from labeled data.

Stage D will add a learned ranker (logistic regression over a fixed feature
vector). Stage C is the prerequisite: log a per-`(searchQueryId, trackId)`
feature vector for every candidate that surfaces in a search, so Stage D has
training data on day one. C1 covers cheap features computable at search-
persistence time; C2 backfills Discogs-derived features asynchronously; C3
joins the existing co-occurrence caches. The shape we commit to now is the
shape Stage D inherits.

**Decision:**
A single `CandidateFeatures` Postgres table, one row per candidate per
search, with an explicit column per feature (no `Json` blob).

- Composite uniqueness on `(searchQueryId, trackId)` — re-running a search
  produces a new row because the same candidate can have different
  `nSources` / `topRank` / `rrfScore` in different searches, and Stage D
  should learn from those variations rather than collapsing them.
- Cheap features (`bpmDelta`, `keyCompat`, `energyDelta`, `labelMatch`,
  `genreMatch`, `nSources`, `topRank`, `hasEmbed`, `rrfScore`) are
  populated synchronously after `aggregateTracks` returns.
- C2 columns (`yearProximity`, `artistCorelease`) and C3 columns
  (`cooccurrenceTrackid`, `appearsInLastfm/Cosine/Yandex`) are added now
  as nullable to avoid a follow-up migration when those sub-stages land.
- Numerical features are nullable, not zero-defaulted. Logistic regression
  treats "missing data" and "value happens to be 0" differently; for "this
  track has no BPM" the right signal is `NULL`, not `0`. Structural
  features (`nSources`, `topRank`, `hasEmbed`, `rrfScore`) are always
  defined and therefore `NOT NULL`.
- Indexes on `searchQueryId`, `trackId`, `createdAt` for Stage D's training
  export queries (group by search, join to favorites/dislikes, time-box).

Computation lives in `python-service/app/feature_extraction/` (pure
function from inputs to feature dict, no I/O). The web service fires a
fire-and-forget `POST /features/extract` after `saveTracks` completes; the
Python endpoint persists via `app.core.db.upsert_candidate_features_batch`,
mirroring the pattern already used for the trackid co-occurrence cache.

**Consequences:**
- Positive: Stage D can train without further schema changes; column
  layout matches the feature vector shape directly.
- Positive: features write is decoupled from the search response. Failures
  to persist features do not affect what the user sees — they only affect
  Stage D's training set growth rate.
- Positive: per-search rows preserve the variance Stage D needs (same
  candidate's `nSources`/`topRank` differ across searches; that signal is
  exactly what RRF discards and a learned model can recover).
- Negative: storage grows linearly with searches. ~150 bytes per row,
  ~40 candidates per search → ~6 KB/search. At 100 searches/day this is
  ~600 KB/day; trivial at this scale, worth revisiting at 100× growth.
- Negative: schema is wider than C1 alone needs. The reserved C2/C3
  columns are dead weight until those sub-stages ship. The trade is one
  fewer migration during Stage C.
- Negative: a re-run of an identical search overwrites the previous row
  (ON CONFLICT DO UPDATE) rather than versioning. Acceptable because
  Stage D's training query is "latest features per (search, track)", and
  versioning would multiply storage with no learning benefit.

**Alternatives considered:**
- One table per feature group (cheap / Discogs / co-occurrence) —
  rejected, joins triple in Stage D's training query and the columns are
  conceptually one vector, not three.
- `Json` blob for the feature dict — rejected, Stage D needs to query
  individual features for analysis (per-feature null rates, per-feature
  value distributions). Postgres JSON path expressions are workable but
  slower and clumsier than typed columns.
- Compute features synchronously inside `aggregateTracks` — rejected,
  observability must not block the hot path. Even cheap features have
  no business adding latency to user-perceived search response.
- Compute features in TypeScript (avoid the extra Python round-trip) —
  rejected, would duplicate the feature logic across two languages.
  Stage D's training pipeline lives in Python; Python is the canonical
  feature-extraction host.

**Revisit when:**
- Stage D ships and we know which features actually contribute weight —
  zero-weight features are candidates for removal from the schema.
- Per-day candidate volume grows past ~100 KB/day to the point of
  considering partitioning by `createdAt`.
- A feature requires a value that isn't available at search-persistence
  time AND isn't suitable for the C2-style background fill (e.g. needs
  user feedback from a session). At that point the schema gains a third
  population path beyond synchronous and background.
