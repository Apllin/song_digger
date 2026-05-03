> **Stage A audit — current-state snapshot.** Describes scoring as of
> 2026-05-01 (commit `e9ac243` plus working-tree edits). This is the
> baseline reference that Stages B–D will mutate. Where `scoring.md`
> describes the *intended* architecture, this document describes only what
> the code actually executes today.
>
> **Frozen historical record.** Constants and code paths called out as
> "currently inert" / "currently exist" below describe the 2026-05-01
> state. Some have since been removed — for example
> `computeEffectiveSource`, `LIKED_WEIGHT_PER_TRACK`, and
> `LIKED_WEIGHT_MAX` are no longer in `aggregator.ts` (Stage A.5 cleanup).
> 1001tracklists (mentioned in §6.6 / §6.7) was removed in Stage A.5 v2
> (ADR-0012). Trust `scoring.md` for current behavior; trust this doc
> only for the snapshot it was taken on.

# Scoring — current state

## 1. Pipeline overview

End-to-end flow from `POST /api/search` to the candidate list returned to
the client:

1. [web/app/api/search/route.ts:74-100](web/app/api/search/route.ts#L74-L100) — `POST /api/search` validates the body
   (Zod), runs `parseQuery(input)` to split it into `{artist, track}`,
   creates a `SearchQuery` row with `status="running"`, and returns the
   row id immediately. The actual work happens in `runSearch`, fired
   without `await` (background task).
2. [web/app/api/search/route.ts:192-201](web/app/api/search/route.ts#L192-L201) — `runSearch` calls `fetchSimilarTracks`
   (HTTP `POST {PYTHON_SERVICE_URL}/similar`) with
   `sources: ["youtube_music", "cosine_club"]`, `limit_per_source: 40`.
   *Note*: the Python route ignores `sources` (see §6).
3. [python-service/app/api/routes/similar.py:393-401](python-service/app/api/routes/similar.py#L393-L401) — `find_similar`
   branches on whether `track` is set:
   - track-mode → `_find_by_artist_and_track`
   - artist-only → `_find_by_artist_only`
4. [python-service/app/api/routes/similar.py:227-234](python-service/app/api/routes/similar.py#L227-L234) — Phase 1 fan-out
   (track mode): Cosine.club, YouTube Music radio, Bandcamp (4 s
   timeout), Yandex Music, and a YTM `search_songs` lookup for the
   queried track all run in parallel via `asyncio.gather`.
5. [python-service/app/api/routes/similar.py:253](python-service/app/api/routes/similar.py#L253) — `_extract_source_meta` infers
   source BPM/key/energy from the median of the top-5 Cosine results and
   computes a `cosine_confident` flag (mean top-5 score ≥ 0.5).
6. [python-service/app/api/routes/similar.py:256-310](python-service/app/api/routes/similar.py#L256-L310) — Phase 2 fallbacks
   (only when `cosine_confident == False`): reversed-order Cosine query,
   Beatport top-3 search for source BPM/key, Cosine artist-only search,
   Bandcamp artist-only search. All run in parallel.
7. [python-service/app/api/routes/similar.py:313-314](python-service/app/api/routes/similar.py#L313-L314) — When still not
   confident, drop individual Cosine results below the 0.5 score
   threshold.
8. [python-service/app/api/routes/similar.py:331-341](python-service/app/api/routes/similar.py#L331-L341) — Build per-source
   `SourceList` objects: each goes through `_filter_artist`
   (token-based same-artist filter) and `_dedup_within_source`
   (drop duplicate `sourceUrl` within the list). Source order is fixed:
   `cosine_club`, `youtube_music`, `bandcamp`, `yandex_music`.
9. [python-service/app/api/routes/similar.py:406-423](python-service/app/api/routes/similar.py#L406-L423) — Inline Beatport
   enrichment: pick the first 6 unique tracks across all source lists
   missing BPM or key, fan out to Beatport with a semaphore of 8, write
   results back into the source lists.
10. [python-service/app/api/routes/similar.py:425-433](python-service/app/api/routes/similar.py#L425-L433) — Return
    `SimilarResponse` with `source_lists`, `source_artist`, `source_bpm`,
    `source_key`, `source_energy`, `source_label`, `source_genre`.
11. [web/app/api/search/route.ts:218-225](web/app/api/search/route.ts#L218-L225) — `hydrateFromCache` reads
    `prisma.track` rows by `sourceUrl` for every track in every source
    list and fills BPM/key/energy/genre/label only where Python returned
    null (Python wins on non-null).
12. [web/app/api/search/route.ts:227-236](web/app/api/search/route.ts#L227-L236) — Call `aggregateTracks` (see §3).
13. [web/app/api/search/route.ts:237-246](web/app/api/search/route.ts#L237-L246) — Persist `Track` rows + `SearchResult`
    rows in chunks (`saveTracks`), mark `SearchQuery.status = "done"`,
    record `sourceBpm` / `sourceKey` on the query row.
14. [web/app/api/search/route.ts:250-258](web/app/api/search/route.ts#L250-L258) — Background fill: for tracks beyond
    index 6 still missing BPM/key, call `enqueueBackgroundEnrich`
    (fire-and-forget), which posts to `POST /enrich` and updates
    `Track` rows so the next search hits the cache.

## 2. RRF inputs

The aggregator consumes one ranked list per registered source. Order
within a list is whatever the adapter returned, after the in-Python
`_filter_artist` and `_dedup_within_source` passes.

| Source | Adapter | Ranked-list semantics | Fields populated on `TrackMeta` | Confidence/score field |
|---|---|---|---|---|
| `cosine_club` | [python-service/app/adapters/cosine_club.py:25-36](python-service/app/adapters/cosine_club.py#L25-L36) | `GET /v1/similar?q={artist - track}` — audio-embedding nearest neighbours, ordered by API. | `title`, `artist`, `sourceUrl`, `coverUrl`, `bpm`, `key` (Camelot), `energy`, `genre`, `label`, `score` | Yes — `score` (0–1). Used (a) as the `cosine_confident` gate at threshold 0.5 ([similar.py:178](python-service/app/api/routes/similar.py#L178)), (b) to drop individual sub-threshold results when not confident ([similar.py:314](python-service/app/api/routes/similar.py#L314)). **Not** used by the web aggregator — `rrfFuse` ignores `score` entirely. |
| `youtube_music` | [python-service/app/adapters/youtube_music.py:55-82](python-service/app/adapters/youtube_music.py#L55-L82) | YTM Radio (`playlistId="RDAMVM{videoId}"`) — Google's radio queue. Skip first item (the seed). | `title`, `artist`, `sourceUrl`, `embedUrl` (the YouTube `/embed/` iframe URL), `coverUrl` | None. |
| `bandcamp` | [python-service/app/adapters/bandcamp.py:55-63](python-service/app/adapters/bandcamp.py#L55-L63) | Search Bandcamp → fetch the matching track page → parse "you may also like" `data-recommended-from-tralbum` JSON. Hard-timed-out at 4 s. | `title`, `artist`, `sourceUrl`, `embedUrl` (Bandcamp `EmbeddedPlayer` URL), `coverUrl` | None. |
| `yandex_music` | [python-service/app/adapters/yandex_music.py:58-76](python-service/app/adapters/yandex_music.py#L58-L76) | `client.search(...)` → `client.tracks_similar(seed.id)`. No-ops without `YANDEX_MUSIC_TOKEN`. | `title`, `artist`, `sourceUrl`, `coverUrl` | None. |

Beatport is **not** an RRF input. It contributes only as: (a) a fallback
source for inferring the seed's BPM/key when Cosine is unconfident
([similar.py:295-300](python-service/app/api/routes/similar.py#L295-L300)), and (b) a per-track BPM/key/genre/label
enrichment side-channel for the inline budget and the background queue
([beatport.py:100-125](python-service/app/adapters/beatport.py#L100-L125)).

## 3. Post-RRF nudges

After `rrfFuse` ([web/lib/aggregator.ts:131-156](web/lib/aggregator.ts#L131-L156)) and the BPM hard filter
(see §4), `aggregateTracks` applies exactly two `rrfScore` mutations
([web/lib/aggregator.ts:225-237](web/lib/aggregator.ts#L225-L237)):

| Constant | File:line | Value | Trigger | Magnitude |
|---|---|---|---|---|
| `DISLIKED_ARTIST_PENALTY` | [web/lib/aggregator.ts:26](web/lib/aggregator.ts#L26) | `0.012` | Candidate's normalised artist matches any artist in `feedback.disliked` | A 4-source rank-1 track has `rrfScore ≈ 4/61 ≈ 0.0656`; `0.012` is ~18% of that — demotes notably without burying. A single-source rank-1 track has `rrfScore ≈ 1/61 ≈ 0.0164`; the same penalty drops it ~73% (effectively rank-15+). |
| `EMBED_BONUS` | [web/lib/aggregator.ts:27](web/lib/aggregator.ts#L27) | `0.0008` | Candidate has a non-null `embedUrl` (true for all YTM tracks, all Bandcamp tracks; false for raw Cosine/Yandex). | ~5% of a single-source rank-1 score. Effectively a tiebreaker — moves a tied pair by one rank, never reorders by more than ~1 step. |

There are no other modifications to `rrfScore` between fusion and the
final sort. In particular, the existing constants `LIKED_WEIGHT_PER_TRACK`
and `LIKED_WEIGHT_MAX` ([web/lib/aggregator.ts:32-33](web/lib/aggregator.ts#L32-L33)) feed
`computeEffectiveSource` ([web/lib/aggregator.ts:74-111](web/lib/aggregator.ts#L74-L111)), whose
return value is computed inside `aggregateTracks` and then explicitly
discarded with `void effective` ([web/lib/aggregator.ts:210](web/lib/aggregator.ts#L210)). The
liked-centroid blend is dead code at the moment.

## 4. Hard filters

Every place a candidate can be dropped entirely:

1. **Cosine confidence filter (per-track)** — [similar.py:313-314](python-service/app/api/routes/similar.py#L313-L314).
   When `cosine_confident == False`, drop Cosine results with `score is None or score < 0.5`. Applies only to the Cosine list.
2. **Source-artist filter (cross-source)** — [similar.py:331-334](python-service/app/api/routes/similar.py#L331-L334).
   `_filter_artist` drops any track whose artist token-matches `source_artist`
   (the YTM-search-resolved artist, falling back to first Cosine, then
   first YTM track). Always on. Same-artist token logic at [similar.py:45-69](python-service/app/api/routes/similar.py#L45-L69).
3. **Within-source dedup by URL** — [similar.py:206-215](python-service/app/api/routes/similar.py#L206-L215).
   `_dedup_within_source` drops repeated `sourceUrl` within a single source
   list, preserving order.
4. **BPM range filter** — [web/lib/aggregator.ts:214-223](web/lib/aggregator.ts#L214-L223).
   Drops `t.bpm < filters.bpmMin || t.bpm > filters.bpmMax` only when both
   bounds are set. Tracks with `bpm == null` are kept (metadata gap is not
   a reason to exclude).

There is no key filter, no genre filter, no energy filter, and no
score-floor filter applied in the web aggregator. Camelot key and genre
arrive on candidates but never gate or score them.

## 5. Metadata flow

For a single candidate, BPM/key/energy/label/genre arrive via this
ordering (later steps fill nulls but never overwrite non-nulls):

1. **Adapter response** ([similar.py:227-234](python-service/app/api/routes/similar.py#L227-L234)). Per-source population:
   - `cosine_club` — populates BPM, key (Camelot), energy, genre, label,
     score for most catalog tracks. **Sometimes-populated**: long-tail
     items occasionally arrive with nulls.
   - `youtube_music` — **never** populates BPM/key/energy/genre/label.
   - `bandcamp` — **never** populates BPM/key/energy/genre/label.
   - `yandex_music` — **never** populates BPM/key/energy/genre/label.
2. **Inline Beatport enrichment** ([similar.py:406-423](python-service/app/api/routes/similar.py#L406-L423)). For up to 6
   unique tracks across all source lists missing BPM **or** key, scrape
   Beatport search and fill BPM, key (Camelot via `CAMELOT_MAP`),
   genre, label — but only on the `model_copy` returned by
   `enrich_tracks`, which preserves any existing non-null fields
   ([beatport.py:118-122](python-service/app/adapters/beatport.py#L118-L122)). Inline-fills back into the same
   source-list rows by `sourceUrl`.
3. **Postgres cache hydrate** ([web/app/api/search/route.ts:19-47](web/app/api/search/route.ts#L19-L47)).
   Reads `Track` rows by `sourceUrl`, fills BPM/key/energy/genre/label
   only where Python returned null. Python wins on non-null
   (intentional: cache rows may be stale, fresh fetch is preferred).
4. **Cross-source merge during RRF** ([web/lib/aggregator.ts:116-124](web/lib/aggregator.ts#L116-L124)).
   `mergeMetadata` is called when the same identity (artist+normalised
   title) appears in multiple source lists: existing non-null values are
   kept, and only nulls are filled from the newcomer. First-seen-wins on
   the field-by-field merge.
5. **Persist back to `Track`** ([web/app/api/search/route.ts:120-153](web/app/api/search/route.ts#L120-L153)).
   `prisma.track.upsert` writes BPM/key/energy/genre/label on insert; on
   update only writes non-null values (`?? undefined` skips the field).
6. **Background fill** ([web/lib/enrichment-queue.ts:12-40](web/lib/enrichment-queue.ts#L12-L40)). For
   tracks beyond inline budget (index ≥ 6) still missing BPM/key, calls
   `POST /enrich` (Beatport) and writes BPM/key/energy/genre/label into
   `Track`. The next search through the same `sourceUrl` picks these up
   via step 3.

**Precedence summary** (highest wins on conflict): per-source values from
the current Python fetch > inline Beatport enrichment > Postgres-cache
hydrate > RRF cross-source merge from a sibling list > background-fill.
"Wins" here means "is the value seen by `aggregateTracks`"; the
background fill only affects subsequent searches.

## 6. Known gaps

Things that the surrounding documentation, comments, or constants imply
SHOULD happen but do not:

1. **Liked-centroid blend is computed and discarded.**
   `computeEffectiveSource` ([web/lib/aggregator.ts:74-111](web/lib/aggregator.ts#L74-L111)) builds
   an `effective` BPM/key/energy that blends source values with the
   liked-track centroid, but its return is `void effective`-ed at
   [aggregator.ts:210](web/lib/aggregator.ts#L210). Nothing in the pipeline
   reads it. The constants `LIKED_WEIGHT_PER_TRACK`, `LIKED_WEIGHT_MAX`
   are inert.
2. **`label` and `genre` are populated but never scored.**
   Both fields arrive on candidates (Cosine, Beatport) and are merged
   across sources, but `aggregateTracks` never references them. The
   `_sourceLabel`/`_sourceGenre` parameters are explicitly underscored to
   acknowledge they're unused ([aggregator.ts:199-201](web/lib/aggregator.ts#L199-L201)).
   The `SimilarResponse` carries `source_label` and `source_genre` for
   every search but they're discarded after the route handler. The
   `scoring.md` "Genre exact-match bonus (+0.001)" and "Label graph
   proximity bonus" do not exist in code.
3. **Cosine `score` is not used for ranking.**
   Each Cosine result carries an audio-similarity score, but `rrfFuse`
   uses only the rank position. The 0.5 threshold gates fallbacks and
   per-track inclusion only.
4. **Camelot key is populated but never scored.**
   No key compatibility scoring or filtering anywhere in the aggregator.
   ADR-0005 states this is intentional ("soft signal"), but no soft
   signal is in fact applied.
5. **BPM is a hard filter only — no proximity scoring.**
   ADR-0003 notes the per-track Gaussian BPM decay was removed alongside
   the weighted-sum scorer and "[may] hybridise back" if eval shows
   regression. Currently nothing scores BPM proximity to the seed.
6. **Tier-based fallback (ADR-0008) is not implemented.**
   Phase 2 fallback in [similar.py:256-310](python-service/app/api/routes/similar.py#L256-L310) is the only "fallback" — a
   binary cosine-confident / not-confident split. There is no tier
   classification, no tier label exposed to the UI, and no tag-only
   tier 4 path. No Last.fm, no 1001tracklists, no trackid.net adapters
   exist in [python-service/app/adapters/](python-service/app/adapters/).
7. **Co-occurrence sources (1001tracklists, trackid.net) not present.**
   Stage B is expected to add these.
8. **No feature-extraction pipeline.**
   No code path computes derived audio features beyond what individual
   adapters return. Per memory: audio features intentionally
   deprioritised in favour of latency, with Camelot key as the priority
   signal.
9. **`sources` request field is ignored by the Python service.**
   The web caller passes `sources: ["youtube_music", "cosine_club"]`
   ([route.ts:196](web/app/api/search/route.ts#L196)), but
   `_find_by_artist_and_track` always fans out to all four adapters
   plus Beatport. The field exists on `SimilarRequest`
   ([models.py:23](python-service/app/core/models.py#L23)) but is never read.
10. **Year/era proximity not modelled.** No `releaseYear` or
    `releaseDate` on `TrackMeta` / `Track` — no signal exists to act on.
11. **Artist co-release / sibling-artist signal not modelled.** No
    Discogs collaboration graph, no shared-label artist linkage. The
    Discogs adapter exists ([python-service/app/adapters/discogs.py](python-service/app/adapters/discogs.py)) but is
    not invoked by `/similar`.
12. **Diversification is post-score only.**
    `diversifyArtists` ([aggregator.ts:162-186](web/lib/aggregator.ts#L162-L186)) reorders the
    final list (max 2 consecutive same-artist) but does not penalise
    the `rrfScore`. The persisted `score` reflects pre-diversification
    fusion order; the displayed list reflects post-diversification.

## 7. Calibration table

Every constant currently affecting ranking, fallback selection, or
ranked-list composition. Last-changed values are derived from `git
blame`; the repo's only commit so far is `e9ac243` (2026-04-23, "chore:
initial monorepo setup").

| Constant | File:line | Current value | Last changed |
|---|---|---|---|
| `RRF_K` | [web/lib/aggregator.ts:21](web/lib/aggregator.ts#L21) | `60` | working tree (uncommitted) |
| `DISLIKED_ARTIST_PENALTY` | [web/lib/aggregator.ts:26](web/lib/aggregator.ts#L26) | `0.012` | working tree (uncommitted) |
| `EMBED_BONUS` | [web/lib/aggregator.ts:27](web/lib/aggregator.ts#L27) | `0.0008` | working tree (uncommitted) |
| `LIKED_WEIGHT_PER_TRACK` | [web/lib/aggregator.ts:32](web/lib/aggregator.ts#L32) | `0.12` (currently inert; see §6.1) | e9ac243 |
| `LIKED_WEIGHT_MAX` | [web/lib/aggregator.ts:33](web/lib/aggregator.ts#L33) | `0.65` (currently inert) | e9ac243 |
| Diversification window | [web/lib/aggregator.ts:164](web/lib/aggregator.ts#L164) | `maxConsecutive = 2` | working tree (uncommitted) |
| `BANDCAMP_TIMEOUT` | [python-service/app/api/routes/similar.py:20](python-service/app/api/routes/similar.py#L20) | `4.0` s | e9ac243 |
| `MAX_TRACKS` | [python-service/app/api/routes/similar.py:34](python-service/app/api/routes/similar.py#L34) | `500` (referenced as a guard ceiling; not enforced in the current code path) | working tree |
| `INLINE_BUDGET` (python) | [python-service/app/api/routes/similar.py:37](python-service/app/api/routes/similar.py#L37) | `6` | working tree (uncommitted) |
| `INLINE_BUDGET` (web) | [web/app/api/search/route.ts:12](web/app/api/search/route.ts#L12) | `6` (must match python) | working tree (uncommitted) |
| `ENRICH_CONCURRENCY` | [python-service/app/api/routes/similar.py:38](python-service/app/api/routes/similar.py#L38) | `8` | e9ac243 |
| `COSINE_CONFIDENCE_THRESHOLD` | [python-service/app/api/routes/similar.py:162](python-service/app/api/routes/similar.py#L162) | `0.5` | e9ac243 |
| Source-meta top-N (BPM/key/energy/label/genre inference) | [python-service/app/api/routes/similar.py:175](python-service/app/api/routes/similar.py#L175), [similar.py:194](python-service/app/api/routes/similar.py#L194) | `top = cosine_tracks[:5]` | e9ac243 |
| Beatport `find_similar` for source-meta fallback | [python-service/app/api/routes/similar.py:275](python-service/app/api/routes/similar.py#L275) | `limit=3` | e9ac243 |
| Beatport `_fetch_bpm_key` candidate window | [python-service/app/adapters/beatport.py:132](python-service/app/adapters/beatport.py#L132) | `limit=5`; artist prefix match `[:6]`, title prefix match `[:8]` | e9ac243 |
| Cosine fallback: artist-only seeding cutoff | [python-service/app/api/routes/similar.py:370](python-service/app/api/routes/similar.py#L370) | `len(cosine_tracks) < 8` triggers seeded second query | e9ac243 |
| `limit_per_source` (web → python) | [web/app/api/search/route.ts:197](web/app/api/search/route.ts#L197) | `40` | working tree (uncommitted) |
| `DB_CHUNK_SIZE` (persistence batching, not ranking) | [web/app/api/search/route.ts:107](web/app/api/search/route.ts#L107) | `50` | working tree (uncommitted) |

Things that look like calibration knobs but aren't:
- Title-strip whitelist — these are correctness rules for dedup, not
  tunable weights ([similar.py:86-110](python-service/app/api/routes/similar.py#L86-L110), mirrored in
  [aggregator.ts:46-55](web/lib/aggregator.ts#L46-L55)).
- `CAMELOT_MAP` — exhaustive note-name → Camelot mapping, not a tunable
  ([beatport.py:10-29](python-service/app/adapters/beatport.py#L10-L29)).
