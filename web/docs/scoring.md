# Scoring Architecture

## What this document covers

How `POST /api/search` ranks candidate tracks today — sources, fusion,
post-fusion nudges, and hard filters — as actually implemented in
[web/lib/aggregator.ts](../lib/aggregator.ts) and
[python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py).

For the rationale behind specific decisions, see ADRs in
[web/docs/decisions/](decisions/). The deeper line-by-line audit that
produced this document lives at [scoring-current-state.md](scoring-current-state.md)
and should be treated as historical context rather than a parallel
description of behavior.

> **Conflict-resolution rule.** Where this document and an ADR disagree,
> this document describes what runs; the ADR may describe a deferred or
> abandoned plan. ADR-0005 (key as soft signal) and ADR-0008 (tier-based
> fallback) are both currently in this state — see "What this document
> does NOT cover" below.

## Pipeline at a glance

A search hits the web app, fans out to the Python service for source
fetches, comes back to web for cache hydration + fusion + persistence:

1. `POST /api/search` validates the body, parses `{artist, track}` from
   the query, creates a `SearchQuery` row with `status="running"`, and
   returns its id immediately. The actual work runs as a fire-and-forget
   background task.
2. Web calls `POST {PYTHON_SERVICE_URL}/similar`. Python branches on
   whether `track` is set (track-mode vs artist-only) and fans out to
   adapters in parallel.
3. **Phase 1** (track-mode): Cosine.club, YouTube Music radio, Bandcamp
   (4 s timeout), Yandex Music, Last.fm `track.getSimilar`, trackid.net
   DJ-set co-occurrence (rewritten as JSON API client and enabled in
   2026-05 — see ADR-0014; ADR-0012 covers the related 1001TL removal),
   and a YTM song-lookup all start simultaneously. Source
   BPM/key/energy/label/genre are inferred from the median of the top-5
   Cosine results (post-2026-05 Cosine API migration: Cosine no longer
   returns BPM/key/energy/label/genre fields, so this inference now
   yields Nones in practice and the Beatport fallback below carries the
   load), and a `cosine_confident` flag is set when the mean top-5
   cosine score ≥ 0.5.
4. **Phase 1.5 — Last.fm artist fallback**: when `track.getSimilar`
   returned 0 results AND `lastfm_artist_fallback_enabled = True`
   (default), the Last.fm adapter expands via
   `artist.getSimilar(seed_artist)` → top-3 tracks per similar artist
   for the top 10 artists, scored by `match × position_decay`, capped
   at 30 candidates. Artist similars cached in `LastfmArtistSimilars`
   with 30-day TTL. This is the highest-yield underground-seed
   recovery path.
5. **Phase 2** (only when `cosine_confident == False`): reversed-order
   Cosine query, Beatport top-3 lookup for source BPM/key, Cosine
   artist-only search, Bandcamp artist-only search. When still not
   confident, individual Cosine results below the 0.5 score threshold
   are dropped.
6. Per-source `SourceList` objects are built, each filtered through
   `_filter_artist` (remove the seed's own artist by token match) and
   `_dedup_within_source` (drop duplicate `sourceUrl`).
7. **Inline Beatport enrichment**: the first 6 unique tracks across all
   source lists missing BPM or key get fanned out to Beatport (semaphore
   8) and the results written back into the source lists.
8. Python returns `SimilarResponse` with the source lists plus seed
   metadata.
9. Web hydrates each track from Postgres `Track` rows by `sourceUrl`,
   filling BPM/key/energy/genre/label only where Python returned null.
10. `aggregateTracks` runs RRF fusion, post-RRF nudges, and artist
    diversification (see sections below).
11. Tracks are persisted (`Track` upserts + `SearchResult` rows), the
    `SearchQuery` row is marked `status="done"`, and tracks beyond
    index 6 still missing BPM/key are queued for background Beatport
    enrichment so the next search hits the cache.

## Sources and what they contribute

The aggregator consumes one ranked list per source. Order within a list
is whatever the adapter returned, after the in-Python `_filter_artist`
and `_dedup_within_source` passes.

| Source | Adapter | Ranked-list semantics | Fields populated on `TrackMeta` | Has its own score? |
|---|---|---|---|---|
| `cosine_club` | [cosine_club.py](../../python-service/app/adapters/cosine_club.py) | Two-step: `GET /v1/search?q={artist - track}` → `GET /v1/tracks/{id}/similar` (audio-embedding nearest neighbours, ordered by API). | `title`, `artist`, `sourceUrl`, `coverUrl`, `score`. Post-2026-05 API migration the public schema no longer exposes BPM/key/energy/label/genre — those now come from Beatport enrichment only. | Yes (`score` ∈ [0, 1]) — used as the `cosine_confident` gate (threshold 0.5) and to drop sub-threshold individual results when not confident. **Not** consumed by the web aggregator: `rrfFuse` ignores `score`. |
| `youtube_music` | [youtube_music.py](../../python-service/app/adapters/youtube_music.py) | YTM Radio (`playlistId="RDAMVM{videoId}"`); seed itself is skipped. | `title`, `artist`, `sourceUrl`, `embedUrl`, `coverUrl` | No |
| `bandcamp` | [bandcamp.py](../../python-service/app/adapters/bandcamp.py) | Search → fetch matching track page → parse "you may also like" `data-recommended-from-tralbum` JSON. Hard 4 s timeout. | `title`, `artist`, `sourceUrl`, `embedUrl`, `coverUrl` | No |
| `yandex_music` | [yandex_music.py](../../python-service/app/adapters/yandex_music.py) | `client.search(...)` → `client.tracks_similar(seed.id)`. No-op without `YANDEX_MUSIC_TOKEN`. | `title`, `artist`, `sourceUrl`, `coverUrl` | No |
| `lastfm` | [lastfm.py](../../python-service/app/adapters/lastfm.py) | `track.getSimilar` (collaborative-filtering). When that returns empty AND `lastfm_artist_fallback_enabled` (default True), expands via `artist.getSimilar` → top-3 per similar artist, capped at 30 (see Phase 1.5 above). No-op without `LASTFM_API_KEY`. | `title`, `artist`, `sourceUrl`, `coverUrl`, `score` (`match` value or `match × position_decay` in fallback) | Yes (`score` is the Last.fm `match` value or fallback decay product). Used as a noise floor (`MIN_MATCH = 0.05`); not consumed by `rrfFuse`. |
| `trackidnet` | [trackidnet.py](../../python-service/app/adapters/trackidnet.py) | DJ-set co-occurrence via the public JSON API (3 endpoints). `/musictracks` resolves the seed; `/audiostreams?musicTrackId=<id>` lists up to `MAX_PLAYLISTS=15` known sets (sorted by `addedOn` desc); `/audiostreams/<slug>` is fetched for each (concurrent, `Semaphore(DETAIL_CONCURRENCY=5)`). Per playlist: pick latest non-empty detection process, find seed by slug, take the `±WINDOW=5` tracks around the first occurrence (excluding all seed instances). Aggregate across windows by slug; sort by co-occurrence count desc, then `referenceCount` asc. Enabled by default (`trackidnet_enabled = True`) — see ADR-0014. | `title`, `artist`, `sourceUrl`, `score` (co-occurrence count, 1..15) | Yes (`score` = co-occurrence count). Not consumed by `rrfFuse` (rank-based). |

Beatport is **not** an RRF input. It contributes only as: (a) a fallback
source for inferring the seed's BPM/key when Cosine is unconfident, and
(b) a per-track BPM/key/genre/label enrichment side-channel (inline
budget + background queue).

## Fusion: RRF

Each source produces a ranked list. A candidate's fused score is

```
rrfScore = Σ_i  1 / (k + rank_i)
```

summed over the source lists where the candidate appears, with `k = 60`
(Cormack 2009 default). Tracks not in any source list get `rrfScore = 0`.
Identity is `(normalizedArtist, normalizedTitle)` — the same identity
appearing in multiple sources accumulates score, which is how
multi-source agreement emerges naturally from the math instead of being
engineered.

Why RRF and not weighted-sum: scores from different sources aren't on
comparable scales (cosine similarity ≠ tag Jaccard ≠ co-play frequency).
Ranks are. See [decisions/0003-rrf-fusion.md](decisions/0003-rrf-fusion.md).

### Metadata merge across sources

When the same identity appears in multiple lists, `mergeMetadata`
([aggregator.ts](../lib/aggregator.ts)) keeps existing non-null values
on the candidate and only fills nulls from the newcomer (first-seen
wins, field-by-field).

The end-to-end precedence on conflict, highest-wins, for any single
metadata field reaching `aggregateTracks`:

1. Per-source values from the current Python fetch
2. Inline Beatport enrichment (only fills nulls; preserves existing values)
3. Postgres-cache hydrate (only fills where Python returned null)
4. RRF cross-source merge from a sibling list (only fills nulls)

Background-fill writes don't count here — they only affect *subsequent*
searches by populating `Track` rows.

## Post-RRF adjustments

After fusion and the BPM hard filter, `aggregateTracks` applies exactly
two `rrfScore` mutations, then re-sorts:

| Constant | Value | Trigger |
|---|---|---|
| `DISLIKED_ARTIST_PENALTY` | `0.012` | Candidate's normalized artist matches any artist in `feedback.disliked`. A 4-source rank-1 track has `rrfScore ≈ 0.066`; this is ~18% of that — demotes notably without burying. |
| `EMBED_BONUS` | `0.0008` | Candidate has a non-null `embedUrl` (true for all YTM and Bandcamp tracks). ~5% of a single-source rank-1 score — effectively a tiebreaker. |

After re-sort, `diversifyArtists` reorders the list so no artist appears
more than 2 times consecutively. Diversification rearranges the output
but does not modify `rrfScore`; the persisted `score` reflects the
post-nudge fusion order, the displayed list reflects post-diversification.

## Hard filters

Every place a candidate can be dropped entirely:

1. **Cosine confidence (per-track)** — when `cosine_confident == False`,
   Cosine results with `score is None or score < 0.5` are dropped from
   the Cosine list ([similar.py](../../python-service/app/api/routes/similar.py)).
   Applies only to the Cosine list.
2. **Source-artist filter (cross-source)** — `_filter_artist` drops any
   track whose artist token-matches `source_artist` (the YTM-resolved
   artist, falling back to first Cosine, then first YTM track). Always
   on. See [decisions/0002-source-artist-filter.md](decisions/0002-source-artist-filter.md).
3. **Within-source URL dedup** — `_dedup_within_source` drops repeated
   `sourceUrl` within a single source list, preserving order.
4. **BPM range filter** — drops `t.bpm < bpmMin || t.bpm > bpmMax` only
   when both bounds are set. Tracks with `bpm == null` are kept (a
   metadata gap is not a reason to exclude).

There is no key filter, genre filter, energy filter, or score-floor
filter in the web aggregator. Camelot key and genre arrive on candidates
but never gate or score them today (see "What this document does NOT cover").

## Calibration table

Every constant currently affecting ranking, fallback selection, or
ranked-list composition. Any change to a value here requires running
`pnpm eval` and attaching the metric diff to the PR.

| Constant | File | Current value |
|---|---|---|
| `RRF_K` | [web/lib/aggregator.ts](../lib/aggregator.ts) | `60` |
| `DISLIKED_ARTIST_PENALTY` | [web/lib/aggregator.ts](../lib/aggregator.ts) | `0.012` |
| `EMBED_BONUS` | [web/lib/aggregator.ts](../lib/aggregator.ts) | `0.0008` |
| Diversification window | [web/lib/aggregator.ts](../lib/aggregator.ts) | `maxConsecutive = 2` |
| `BANDCAMP_TIMEOUT` | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `4.0` s |
| `INLINE_BUDGET` (python) | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `6` |
| `INLINE_BUDGET` (web) | [web/app/api/search/route.ts](../app/api/search/route.ts) | `6` (must match python) |
| `ENRICH_CONCURRENCY` | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `8` |
| `COSINE_CONFIDENCE_THRESHOLD` | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `0.5` |
| Source-meta top-N (BPM/key/energy/label/genre inference) | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `cosine_tracks[:5]` |
| Beatport `find_similar` for source-meta fallback | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `limit=3` |
| Beatport `_fetch_bpm_key` candidate window | [python-service/app/adapters/beatport.py](../../python-service/app/adapters/beatport.py) | `limit=5`; artist prefix `[:6]`, title prefix `[:8]` |
| Cosine fallback: artist-only seeding cutoff | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `len(cosine_tracks) < 8` triggers seeded second query |
| `limit_per_source` (web → python) | [web/app/api/search/route.ts](../app/api/search/route.ts) | `40` |
| `DB_CHUNK_SIZE` (persistence batching, not ranking) | [web/app/api/search/route.ts](../app/api/search/route.ts) | `50` |

Things that look like knobs but aren't:

- **Title-strip whitelist** — correctness rules for dedup, not tunable
  weights ([aggregator.ts](../lib/aggregator.ts), mirrored in
  [similar.py](../../python-service/app/api/routes/similar.py)).
- **`CAMELOT_MAP`** — exhaustive note-name → Camelot mapping, not a
  tunable ([beatport.py](../../python-service/app/adapters/beatport.py)).

## What this document does NOT cover

These are signals that adapters return, ADRs propose, or comments imply
— but that **no code path scores or filters on today**. They're listed
here so a reader doesn't infer behavior from a stray field on a model
or a sentence in an old ADR.

- **Tier-based fallback** — Phase 2's binary `cosine_confident` /
  not-confident split is the only fallback. No tier classification, no
  tier label exposed to the UI, no tag-only tier 4 path. ADR-0008
  describes the tier scheme but it is not implemented; Stage B will
  take a simpler path. See [decisions/0008-tier-based-fallback.md](decisions/0008-tier-based-fallback.md).
- **Label-graph proximity bonus** — deferred indefinitely. ADR-0010 is
  speculative — no graph exists, no bonus is applied. See
  [decisions/0010-label-graph.md](decisions/0010-label-graph.md).
- **Genre exact-match bonus** — `genre` arrives on candidates from
  Cosine and Beatport, is merged across sources, and is persisted on
  `Track`, but `aggregateTracks` never reads it. Will likely reappear
  as a Stage C feature.
- **Camelot key compatibility scoring** — ADR-0005 frames key as a
  "soft signal" but nothing in `aggregateTracks` references the field.
  The `key` column is populated and displayed only. See
  [decisions/0005-key-as-soft-signal.md](decisions/0005-key-as-soft-signal.md).
- **BPM proximity scoring** — BPM is a hard filter only. ADR-0003
  notes the per-track Gaussian BPM decay was removed alongside the
  weighted-sum scorer and may hybridize back if eval shows regression;
  for now there is no proximity scoring. See [decisions/0003-rrf-fusion.md](decisions/0003-rrf-fusion.md).
- **Liked-feedback signal** — the prior hand-rolled liked-centroid
  blend was removed in cleanup pre-Stage-B (the `effective` BPM/key
  computed from liked tracks was never read anyway). It will be
  reintroduced in Stage D as a learned feature inside a logistic
  regression rather than a hand-tuned blend, which is the right shape
  for it.
- **Co-occurrence sources** — Last.fm landed in Stage B
  (track-similar + artist-fallback). Trackid.net was rewritten as a
  JSON API client (playlists-list flow over 3 endpoints, ±5 window
  around the seed in up to 15 fresh sets) and enabled by default in
  2026-05 (see ADR-0014). It contributes alternative-signal candidates
  (DJ-set co-occurrence, not similarity confirmation) and is typically
  unique to its source list, so single-source RRF math keeps its
  candidates at ranks 12+; the contribution is invisible to nDCG@10
  but feeds Stage D learned ranking and Stage C3 features.
  1001tracklists was removed in Stage A.5 v2 (see ADR-0012).
- **Cosine `score` as a ranking signal** — used only as a confidence
  gate (0.5 threshold) and per-track inclusion filter. `rrfFuse` uses
  rank position, not the underlying scores.
- **Year/era proximity** — `Track` has no `releaseYear` / `releaseDate`
  field, so no signal exists to act on.
- **Artist co-release / sibling-artist signal** — the Discogs adapter
  exists ([discogs.py](../../python-service/app/adapters/discogs.py))
  but is not invoked by `/similar`.
- **Learned weights** — all constants above are hand-tuned baselines.
  Stage D introduces a learned ranking layer.
