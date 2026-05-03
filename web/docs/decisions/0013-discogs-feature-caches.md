# 0013 — Discogs feature caches for Stage C2

**Date:** 2026-05-03
**Status:** Accepted

**Context:**
Stage C2 adds two C2 columns to `CandidateFeatures` (ADR-0011):
`yearProximity` (bounded year-distance signal between seed and candidate)
and `artistCorelease` (binary: have these artists shared a Discogs release
credit). Both depend on Discogs data — release year and full credits — that
the project does not currently cache anywhere.

The Discogs REST API is rate-limited at 60 requests/minute authenticated.
Resolving a single seed artist's full credit graph takes one search call,
one paginated releases call, and one credits call per release —
realistically 5–15 requests, 200–500 ms each. A search with ten candidates
that each include a never-before-seen artist would queue another N×K
requests and add 3–10 seconds of synchronous latency to the user response.
That is unacceptable on the search hot path, where the rest of the
pipeline already runs near a 5–8 second budget.

C1 features (cheap, in-process) ship synchronously after `aggregateTracks`
returns. C2 needed a different population pattern: fast enough that the
data lands while it is still useful for Stage D training, but never
blocking the user response. Caching is the lever — Discogs data is
slow-moving (an artist's discography barely changes month-to-month), so
even a weeks-long TTL is fine.

**Decision:**
Two cache tables in the shared Postgres database:

- `ArtistDiscography` — per-artist index of releases. One row per artist
  keyed on a normalized name (NFKD diacritic strip + lowercase + drop
  non-alphanumerics, mirroring `web/lib/aggregator.ts:normalizeArtist`).
  `releases` is a JSON array of `{releaseId, year, title, label}`,
  populated from the Discogs `/database/search` + `/artists/<id>/releases`
  endpoints. `debutYear` is denormalized for cheap "earliest release"
  reads. Read for `yearProximity` (returns scalar year) and as the input
  to collaborator extraction.
- `ArtistCollaborations` — per-artist set of collaborator names, derived
  from `ArtistDiscography.releases` plus per-release credit lookups
  (`/releases/<id>`). One row per artist with a `collaborators` JSON
  array. Read for `artistCorelease` (set membership of candidate
  artist in seed artist's collaborator set).

Population is triggered by `runSearch` in
`web/app/api/search/route.ts` via a fire-and-forget POST to a new
Python route `POST /features/discogs-fill`, parallel to the existing
`/features/extract` (C1) call. The Python handler resolves both seed
and candidate artists' discographies (cache, then API on miss),
derives collaborators, computes the two features per candidate, and
batch-updates the `CandidateFeatures` rows that C1 already created.

Cache TTL is 90 days, evaluated lazily at read time — no scheduled
cleanup. Rows past TTL are treated as misses and refetched. A
discography or collaborator set returning empty from Discogs is
cached as `[]`, distinct from "we haven't checked yet" (`None` /
absence of row).

We considered:

- **Synchronous Discogs lookup during search** — rejected. Latency cost
  (3–10 s per search) would dominate user-perceived performance.
- **A scheduled cron job to backfill `CandidateFeatures` rows where
  C2 columns are still null** — rejected. Adds the operational
  surface of a job scheduler, idempotency tracking, and race handling
  with new searches, for no benefit over per-search fill at the
  current single-user scale. If we ever need a bulk backfill of old
  rows that's a separate manual script, not in scope here.
- **One unified cache table for both features** — rejected. The two
  features have different access shapes (scalar year lookup vs set
  membership) and different update strategies (discography is fetched
  in one call, collaborators are derived from N additional calls).
  Separating them keeps the Stage D training queries one-table-per-
  feature and lets future per-artist features (label history, debut
  year as standalone) extend `ArtistDiscography` without churning the
  collaborator schema.

**Consequences:**
- C2 features are eventually consistent. A search's
  `CandidateFeatures` rows land within the search response (C1 columns
  populated), then `yearProximity` and `artistCorelease` fill in
  within the next few seconds to a couple minutes depending on cache
  hit rate. Stage D training queries naturally filter
  `WHERE yearProximity IS NOT NULL` to exclude not-yet-filled rows;
  this is the same missingness pattern the production scorer will
  handle.
- Storage grows with unique-artist count, not search count. Around
  500 bytes per artist times an estimated few thousand techno
  artists per year of usage is single-digit megabytes — trivial at
  this scale.
- Discogs rate limit becomes the project's effective throughput
  cap on first-time-seen-artist searches. With 60 requests/minute
  and roughly 2–11 calls per uncached artist (1 search + up to
  10 release credits) and ~5 unique-new artists per search,
  sustained throughput is ~5–10 searches/minute on cold caches.
  Acceptable for personal-project use; revisit if real users hit
  this.
- The fill pattern is visible: one route, one set of cache tables,
  one fire-and-forget call. Future asynchronous features (e.g. C3
  cooccurrence joins for trackid) can mirror the shape.

**Alternatives considered:** see Decision section above.

**Revisit when:**
- Sustained search rate pushes Discogs into 429 territory — at that
  point we need a real rate-limited queue, not the current "fire on
  every search and rely on the adapter's per-call retry" model.
- Stage D shows `yearProximity` and `artistCorelease` carry
  materially different weights or interact unexpectedly. If the two
  features end up needing separate refresh policies the split-table
  layout already accommodates that.
- Pre-warming becomes desirable (e.g. a batch fill of top-N techno
  artists before launch). The cache schema is already compatible;
  what changes is the population trigger.
