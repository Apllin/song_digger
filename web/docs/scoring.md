# Scoring Architecture

## What this document covers

How `POST /api/search` ranks candidate tracks today — sources, fusion,
and post-fusion adjustments — as actually implemented in
[web/lib/aggregator.ts](../lib/aggregator.ts) and
[python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py).

For the rationale behind specific decisions, see ADRs in
[web/docs/decisions/](decisions/). The deeper line-by-line audit that
produced this document lives at [scoring-current-state.md](scoring-current-state.md)
and should be treated as historical context rather than a parallel
description of behavior.

> **Conflict-resolution rule.** Where this document and an ADR disagree,
> this document describes what runs; the ADR may describe a deferred,
> abandoned, or superseded plan. ADR-0005 (key as soft signal),
> ADR-0007 (Beatport cache strategy), ADR-0008 (tier-based fallback),
> ADR-0011 (CandidateFeatures), ADR-0013 (Discogs caches) are all in
> this state — superseded or never implemented. ADR-0015, ADR-0016,
> ADR-0017, and ADR-0019 are the current Stage F / Stage H decisions.

## Pipeline at a glance

A search hits the web app, fans out to the Python service for source
fetches, comes back to web for dislike filtering, fusion, and persistence:

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
   and a YTM song-lookup all start simultaneously. A `cosine_confident`
   flag is set when the mean top-5 cosine score ≥ 0.5.
4. **Phase 1.5 — Last.fm artist path**: the Last.fm adapter expands
   via `artist.getSimilar(seed_artist)` → top-3 tracks per similar
   artist for the top 10 artists, scored by `match × position_decay`,
   capped at 30 candidates, in two cases: (a) `track.getSimilar`
   returned 0 results for an Artist–Track query, or (b) the query is
   artist-only with no track component, in which case the adapter
   skips `track.getSimilar` and goes straight to the artist path.
   Artist similars cached in `LastfmArtistSimilars` with 30-day TTL.
   This is the highest-yield underground-seed recovery path. See
   ADR-0022.
5. **Phase 2** (only when `cosine_confident == False`): reversed-order
   Cosine query, Cosine artist-only search, Bandcamp artist-only
   search. When still not confident, individual Cosine results below
   the 0.5 score threshold are dropped.
6. Per-source `SourceList` objects are built, each filtered through
   `_filter_artist` (remove the seed's own artist by token match) and
   `_dedup_within_source` (drop duplicate `sourceUrl`).
7. Python returns `SimilarResponse` with the source lists plus seed
   `source_artist`. Pre-Stage-F seed `source_bpm` / `source_key` /
   `source_energy` were removed in ADR-0016; pre-Stage-H seed
   `source_label` / `source_genre` were removed in ADR-0019.
8. Web filters out any track whose `(normalizeArtist(t.artist),
   normalizeTitle(t.title))` identity is in `DislikedTrack` (one
   Postgres lookup per request, identity-keyed — see ADR-0017).
9. `aggregateTracks` runs RRF fusion and artist diversification (see
   sections below).
10. Tracks are persisted (`Track` upserts + `SearchResult` rows) and
    the `SearchQuery` row is marked `status="done"`.

## Sources and what they contribute

The aggregator consumes one ranked list per source. Order within a list
is whatever the adapter returned, after the in-Python `_filter_artist`
and `_dedup_within_source` passes.

| Source | Adapter | Ranked-list semantics | Fields populated on `TrackMeta` | Has its own score? |
|---|---|---|---|---|
| `cosine_club` | [cosine_club.py](../../python-service/app/adapters/cosine_club.py) | Two-step: `GET /v1/search?q={artist - track}` → `GET /v1/tracks/{id}/similar` (audio-embedding nearest neighbours, ordered by API). | `title`, `artist`, `sourceUrl`, `coverUrl`, `score`. Post-2026-05 API migration the public schema only exposes title/artist/url/cover. | Yes (`score` ∈ [0, 1]) — used as the `cosine_confident` gate (threshold 0.5) and to drop sub-threshold individual results when not confident. **Not** consumed by the web aggregator: `rrfFuse` ignores `score`. |
| `youtube_music` | [youtube_music.py](../../python-service/app/adapters/youtube_music.py) | YTM Radio (`playlistId="RDAMVM{videoId}"`); seed itself is skipped. | `title`, `artist`, `sourceUrl`, `embedUrl`, `coverUrl` | No |
| `bandcamp` | [bandcamp.py](../../python-service/app/adapters/bandcamp.py) | Search → fetch matching track page → parse "you may also like" `<li class="recommended-album">` blocks. Hard 4 s timeout. | `title`, `artist`, `sourceUrl`, `embedUrl`, `coverUrl` | No |
| `yandex_music` | [yandex_music.py](../../python-service/app/adapters/yandex_music.py) | `client.search(...)` → `client.tracks_similar(seed.id)`. No-op without `YANDEX_MUSIC_TOKEN`. | `title`, `artist`, `sourceUrl`, `coverUrl` | No |
| `lastfm` | [lastfm.py](../../python-service/app/adapters/lastfm.py) | `track.getSimilar` (collaborative-filtering) for Artist–Track queries. Falls back to `artist.getSimilar` → top-3 per similar artist (capped at 30) when track-level returns empty, AND for artist-only queries with no track component (see Phase 1.5 above). No-op without `LASTFM_API_KEY`. | `title`, `artist`, `sourceUrl`, `coverUrl`, `score` (`match` value or `match × position_decay` in artist path) | Yes (`score` is the Last.fm `match` value or artist-path decay product). Not consumed by `rrfFuse` and no longer used as a noise floor (ADR-0022). |
| `trackidnet` | [trackidnet.py](../../python-service/app/adapters/trackidnet.py) | DJ-set co-occurrence via the public JSON API (3 endpoints). `/musictracks` resolves the seed; `/audiostreams?musicTrackId=<id>` lists up to `MAX_PLAYLISTS=15` known sets (sorted by `addedOn` desc); `/audiostreams/<slug>` is fetched for each (concurrent, `Semaphore(DETAIL_CONCURRENCY=5)`). Per playlist: pick latest non-empty detection process, find seed by slug, take the `±WINDOW=5` tracks around the first occurrence (excluding all seed instances). Aggregate across windows by slug; sort by co-occurrence count desc, then `referenceCount` asc. Enabled by default (`trackidnet_enabled = True`) — see ADR-0014. | `title`, `artist`, `sourceUrl`, `score` (co-occurrence count, 1..15) | Yes (`score` = co-occurrence count). Not consumed by `rrfFuse` (rank-based). |

The pipeline trusts each adapter's own ranking. Beatport was removed
in ADR-0015 along with the BPM/key fallback and inline enrichment that
fed it; the source adapters here are the entire candidate-generation
surface.

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
wins, field-by-field). After Stage H this only covers `coverUrl` and
`embedUrl` — the other metadata fields no adapter populates were
removed from `TrackMeta` (ADR-0019, ADR-0016).

## Post-RRF adjustments

After fusion, `aggregateTracks` mirrors `rrfScore` onto `score` for
persistence and runs `diversifyArtists`, which reorders the list so no
artist appears more than 2 times consecutively. Diversification
rearranges the output but does not modify `rrfScore`.

The pre-Stage-F `DISLIKED_ARTIST_PENALTY` post-RRF nudge was removed
in ADR-0017 — disliked tracks are now filtered server-side before
fusion, keyed on `(artistKey, titleKey)` identity. The `EMBED_BONUS`
tiebreaker (Stage F) was removed in Stage H Step 1 as a philosophy
violation: post-RRF nudges are score-magic the project has rejected
in favour of "trust the adapters." Inline-playable tracks still
surface as such in the UI via the embed-aware play button, but with
no score boost.

## Hard filters

Every place a candidate can be dropped entirely:

1. **Disliked-track filter (cross-source)** — before fusion runs,
   `/api/search` loads `DislikedTrack` and removes any
   `(normalizeArtist, normalizeTitle)` match from every source list
   (see ADR-0017).
2. **Cosine confidence (per-track)** — when `cosine_confident == False`,
   Cosine results with `score is None or score < 0.5` are dropped from
   the Cosine list ([similar.py](../../python-service/app/api/routes/similar.py)).
   Applies only to the Cosine list.
3. **Source-artist filter (cross-source)** — `_filter_artist` drops any
   track whose artist token-matches `source_artist` (the YTM-resolved
   artist, falling back to first Cosine, then first YTM track). Always
   on. See [decisions/0002-source-artist-filter.md](decisions/0002-source-artist-filter.md).
4. **Within-source URL dedup** — `_dedup_within_source` drops repeated
   `sourceUrl` within a single source list, preserving order.

There is no BPM filter, key filter, genre filter, energy filter, or
score-floor filter in the web aggregator. After Stage H there is also
no embed bonus, no genre dropdown, no feature-extraction tier, and the
`Track` table no longer carries `bpm` / `key` / `energy` / `genre` /
`label` columns.

## Calibration table

Constants currently affecting ranking, fallback selection, or
ranked-list composition:

| Constant | File | Current value |
|---|---|---|
| `RRF_K` | [web/lib/aggregator.ts](../lib/aggregator.ts) | `60` |
| Diversification window | [web/lib/aggregator.ts](../lib/aggregator.ts) | `maxConsecutive = 2` |
| `BANDCAMP_TIMEOUT` | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `4.0` s |
| `TRACKIDNET_TIMEOUT` | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `25.0` s |
| `COSINE_CONFIDENCE_THRESHOLD` | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `0.5` |
| Cosine confidence top-N | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `cosine_tracks[:5]` |
| Cosine fallback: artist-only seeding cutoff | [python-service/app/api/routes/similar.py](../../python-service/app/api/routes/similar.py) | `len(cosine_tracks) < 8` triggers seeded second query |
| `limit_per_source` (web → python) | [web/app/api/search/route.ts](../app/api/search/route.ts) | `40` |
| `DB_CHUNK_SIZE` (persistence batching, not ranking) | [web/app/api/search/route.ts](../app/api/search/route.ts) | `50` |

Things that look like knobs but aren't:

- **Title-strip whitelist** — correctness rules for dedup, not tunable
  weights ([aggregator.ts](../lib/aggregator.ts), mirrored in
  [similar.py](../../python-service/app/api/routes/similar.py)).

## What this document does NOT cover

These are signals that adapters return, ADRs propose, or comments imply
— but that **no code path scores or filters on today**. They're listed
here so a reader doesn't infer behavior from a stray field on a model
or a sentence in an old ADR.

- **BPM / key / energy / genre / label** — no current adapter
  populates these for new tracks, and after Stage H Step 5 the
  corresponding columns are gone from `Track` and the badges from
  `TrackCard`. See ADR-0016 (BPM/key removal) and ADR-0019.
- **Embed bonus** — was a `+0.0008` post-RRF nudge for tracks with
  `embedUrl`. Removed in Stage H Step 1 as a philosophy violation.
- **Genre filter** — was a write-only UI dropdown persisted to
  `SearchQuery.filters`. Removed in Stage H Step 2 (UI + schema +
  plumbing).
- **Tier-based fallback** — Phase 2's binary `cosine_confident` /
  not-confident split is the only fallback. No tier classification, no
  tier label exposed to the UI, no tag-only tier 4 path. ADR-0008
  describes the tier scheme but it is not implemented.
- **Label-graph proximity bonus** — deferred indefinitely. ADR-0010 is
  speculative — no graph exists, no bonus is applied. See
  [decisions/0010-label-graph.md](decisions/0010-label-graph.md).
- **Camelot key compatibility scoring** — ADR-0005 frames key as a
  "soft signal" but nothing in `aggregateTracks` references the field.
  See [decisions/0005-key-as-soft-signal.md](decisions/0005-key-as-soft-signal.md).
- **Liked-feedback signal** — the prior hand-rolled liked-centroid
  blend was removed in cleanup pre-Stage-B. Stage D would have
  reintroduced it as a learned feature; Stage D was cancelled in
  Stage F (ADR-0019).
- **Cosine `score` as a ranking signal** — used only as a confidence
  gate (0.5 threshold) and per-track inclusion filter. `rrfFuse` uses
  rank position, not the underlying scores.
- **Year/era proximity** — `Track` has no `releaseYear` / `releaseDate`
  field, so no signal exists to act on.
- **Artist co-release / sibling-artist signal** — the Discogs adapter
  exists ([discogs.py](../../python-service/app/adapters/discogs.py))
  but is not invoked by `/similar`. After Stage H (ADR-0019), it is
  scoped to the `/discography` and `/labels` page routes only.
- **Learned weights** — Stage D was cancelled (ADR-0019). All
  ranking is rank-fusion with no learned layer.
