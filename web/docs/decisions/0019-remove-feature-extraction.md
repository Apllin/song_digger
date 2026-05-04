# 0019 — Remove feature extraction infrastructure

**Date:** 2026-05-04
**Status:** Accepted

**Context:**
ADR-0011 introduced `CandidateFeatures` (12 columns capturing per-candidate
signals — BPM/key/energy deltas, label/genre matches, source agreement, RRF
score, year proximity, artist co-release, trackid co-occurrence) as the
training-data substrate for Stage D's learned ranker. ADR-0013 added the
`ArtistDiscography` and `ArtistCollaborations` Postgres caches plus a
`POST /features/discogs-fill` route to populate the C2 (Discogs-derived)
columns asynchronously, parallel to the synchronous `POST /features/extract`
that wrote the C1 columns after each search.

Stage F (ADR-0015 / 0016) then reset the project's philosophy to "trust the
adapters, keep the pipeline minimal." Beatport and the BPM/key ranking went
away; the post-Stage-F aggregator is RRF + artist diversification, full stop.
Stage D was cancelled — there is no learned ranker to train, and there is
no plan to ship one.

That left the entire feature-extraction tier write-only:

- Every `/api/search` fired `postExtractFeatures` and `postDiscogsFill`
  fire-and-forget POSTs.
- The Python handlers wrote to `CandidateFeatures`, refreshed the
  `ArtistDiscography` and `ArtistCollaborations` caches, and consumed
  Discogs API rate-limit budget on cache misses.
- `TrackidCooccurrence` had its public read/write helpers in
  `app/core/db.py` but no callers anywhere in the active code path —
  same pattern, even more obviously dead.
- Nothing read any of these tables. Stage D would have, but Stage D
  isn't shipping.

The audit (Stage H) made this concrete: ~1,500 LoC of Python + TypeScript
producing a Postgres write tier that no consumer queried, taking the
project's whole 60-req/min Discogs budget away from the only real
Discogs consumers (the `/discography` and `/labels` page routes).

**Decision:**
Remove the feature-extraction tier in full. Specifically:

- **Database schema** — drop four tables in one migration
  (`20260504163114_remove_feature_extraction_tables`):
  - `CandidateFeatures`
  - `ArtistDiscography`
  - `ArtistCollaborations`
  - `TrackidCooccurrence`

- **Python service** — delete:
  - `python-service/app/feature_extraction/` (`cheap.py`, `discogs.py`,
    package `__init__.py`)
  - `python-service/app/api/routes/features.py`
    (`POST /features/extract`)
  - `python-service/app/api/routes/discogs_features.py`
    (`POST /features/discogs-fill`)
  - The `features_router` and `discogs_features_router` includes from
    `main.py`
  - `_extract_source_label_genre` helper in `similar.py` and the
    `source_label` / `source_genre` fields it produced
  - `SimilarResponse.source_label` / `source_genre` (Pydantic schema)
  - `DiscogsAdapter.fetch_artist_discography` and
    `DiscogsAdapter.fetch_release_credits` — the two adapter methods
    that existed solely to feed `discogs_features.py`. The adapter's
    `search_artist`, `get_releases`, `search_label`,
    `get_label_releases`, `get_tracklist` stay (used by the page routes
    in `discogs.py`).
  - All `app/core/db.py` helpers for the deleted tables:
    `upsert_candidate_features_batch`,
    `update_candidate_features_discogs_batch`,
    `fetch_/upsert_artist_discography_cache`,
    `fetch_/upsert_artist_collaborations_cache`,
    `fetch_/upsert_trackid_cooccurrence_batch`. The Last.fm
    artist-similars cache helpers stay (real readers in the Last.fm
    adapter).
  - `tests/test_feature_extraction.py`,
    `tests/test_features_endpoint.py`,
    `tests/test_discogs_features_route.py` and the C2 test cases in
    `tests/test_discogs.py`

- **Web service** — delete:
  - `postExtractFeatures` and `postDiscogsFill` fire-and-forget calls
    in `app/api/search/route.ts` (and their helper functions and the
    `FusedCandidate` import that fed them). `runSearch` now ends right
    after `saveTracks` updates `SearchQuery.status = "done"`.
  - `SimilarResponse.source_label` / `source_genre` from
    `lib/python-client.ts`.
  - The `candidateFeatures` relation field from `Track` and
    `SearchQuery` Prisma models.

- **Discogs adapter scope** — retained but scoped to the
  `/discography` page (`app/discography/page.tsx`) and the `/labels`
  page (`app/labels/page.tsx`) consumers only. Those reach the adapter
  via the `discogs.py` route module, which is unchanged.

ADR-0011 (CandidateFeatures introduction) and ADR-0013 (Discogs caches)
are marked Superseded with a forward reference to this ADR.

**Consequences:**

- Discogs API budget freed up. The 60-req/min ceiling is no longer
  shared with per-search C2 fills; the entire budget goes to the page
  routes that real users hit.
- Search latency improves marginally — the two fire-and-forget POSTs
  weren't on the user-perceived hot path, but they consumed Python
  worker capacity. `/api/search` now ends with the Postgres
  `SearchQuery.status = "done"` write and that's it.
- Database is four tables smaller. Migrations are forward-only —
  rolling back to the pre-Stage-H schema isn't supported.
- `lib/python-client.ts` `SimilarResponse` shape change is a breaking
  contract update; both sides land in the same commit so dev never
  sees the mismatch. Production has no users yet, so no field migration
  to manage.
- Codebase is roughly 1,500 lines smaller across web + python-service
  + tests. The Discogs adapter shrinks; `app/core/db.py` shrinks; the
  search route reads top-to-bottom without two paragraphs of
  fire-and-forget plumbing.
- If Stage D ever returns, this work is forfeit. We accept that —
  Stage F's "trust the adapters" direction is the active philosophy
  and a reversal would itself need a new ADR. Re-introducing the
  feature tier from the migration history is straightforward; the
  schema is recoverable from the deleted models in this commit's diff.

**Alternatives considered:**

- **Keep the schema, delete only the writers.** Rejected — write-only
  data in a real schema invites drift and confuses readers. If we're
  cancelling the consumer, drop the producer's plumbing too.
- **Leave the Discogs caches in place "for later use."** Rejected —
  same reasoning, plus the caches' TTL logic only makes sense when a
  consumer is calling on a hot path that benefits from the freshness
  decision. With no caller, the TTL is just a cron we never wrote.
- **Keep `source_label` / `source_genre` on `SimilarResponse` as
  metadata (no UI consumer today, but cheap to derive).** Rejected —
  with no consumer, removing them keeps the contract honest. The
  `_extract_source_label_genre` helper is also gone, so this is the
  cleaner shape.
- **Stage the deletion across multiple commits.** Rejected — the
  blast radius is large but the dependency graph is tight (route
  → DB helpers → schema → caller). A single atomic commit lets the
  reader see the whole change as one consistent unit.

**Supersedes:** ADR-0011 (Feature vector schema for learned ranking),
ADR-0013 (Discogs feature caches for Stage C2).
