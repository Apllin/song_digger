# 0024 — Cosine contributes nothing when it doesn't have the queried track

**Date:** 2026-05-12
**Status:** Accepted

**Context:**
For an "Artist – Track" search, `_find_by_artist_and_track` in
`python-service/app/api/routes/similar.py` ran Cosine.club in two phases:

1. **Phase 1** — `_cosine.find_similar("Artist - Track")`. The adapter
   resolves the query to a seed track id via `/v1/search`, gated by
   `query_match_score` (`app/adapters/_seed_match.py`) so a fuzzy hit that
   isn't actually the queried track is rejected and the call returns `[]`.
2. **Phase 2** (when the Phase 1 mean score fell below the ADR-0001
   confidence threshold) — two fallbacks in parallel:
   - the **reversed query** `"Track - Artist"` (covers users who type the
     fields the other way round), and
   - an **artist-only query** `_cosine.find_similar("Artist")`, whose
     results were appended to Cosine's source list as a "style-adjacent"
     supplement.

The artist-only fallback is the bug. `query_match_score` returns
`MATCH_LOOSE` for *any* candidate when the query string has no `" - "`
separator (line: `if " - " not in query: return MATCH_LOOSE`) — there is
nothing to validate a bare artist name against, and the typeahead-driven
UI normally sends the canonical form anyway. So `_cosine.find_similar("Artist")`
accepts whatever Cosine's fuzzy search returns first as the seed and emits
its neighbours. When the queried *track* is genuinely absent from Cosine's
catalogue, those neighbours are recommendations off an unrelated record.

Observed: `BLANKA (ES) - Klock` is not in Cosine. Phase 1 (and the reversed
query) correctly return `[]` — the seed gate rejects the fuzzy hits — but
the Phase 2 artist-only call seeds off some record Cosine's search returned
for `"BLANKA (ES)"` and `/similar` came back with a Cosine source list full
of tracks that have nothing to do with the query. Expected behaviour: if
Cosine doesn't have the track, the Cosine source list is empty.

The artist-only fallback predates the 2026-05 Cosine API migration and
ADR-0022 ("trust the adapter's similarity ordering, stop adding artificial
expansion paths"). ADR-0001 listed "artist-only seeding" as one of the
Phase 2 fallbacks alongside "beatport BPM enrichment" — Beatport is already
gone (ADR-0015), and the artist-only path is the same kind of unmeasured
expansion the project has been removing.

**Decision:**
Remove the artist-only Cosine fallback from `_find_by_artist_and_track`.
Specifically in `python-service/app/api/routes/similar.py`:

- Delete the `_cosine.find_similar(artist, limit)` Phase 2 gather slot,
  the `artist_cosine` accumulation, and the
  `cosine_tracks = cosine_tracks + artist_cosine` append.
- Delete the now-unused `_empty_list()` helper.
- Phase 2 keeps **only** the reversed-query retry. It is still the *same
  track* under a swapped phrasing and is protected by the adapter's
  seed-relevance gate, so it can only land when Cosine genuinely has the
  track. With one coroutine left, the `asyncio.gather(..., return_exceptions=True)`
  collapses to a direct `await` wrapped in `try/except` (the adapter
  already swallows `httpx.HTTPError`; the wrapper catches anything else).
- The ADR-0001 low-confidence per-track filter (`score >= 0.5` when no
  query order produced a confident seed) is unchanged.
- `_find_by_artist_only` is **unchanged** — when the user searches by
  artist with no track component, a bare-artist Cosine query is the
  intended behaviour, not a fallback.
- `web/features/search/searchCache.ts` — bump `SEARCH_CACHE_VERSION` from
  `"v6"` to `"v7"`: the Python `/similar` response changes shape for any
  (artist, track) pair Cosine doesn't have, so cached `v6` payloads are
  stale by definition (CLAUDE.md gotcha).
- Regression test in `python-service/tests/test_regression.py`
  (`test_cosine_track_miss_does_not_fall_back_to_artist_seed`): with Cosine
  mocked to return results only for a bare-artist query and `[]` for either
  dashed order, the `cosine_club` source list must be empty and no
  bare-artist Cosine query may be issued.

**Consequences:**
- Positive: a track Cosine doesn't have produces an empty Cosine source
  list, matching the product expectation. RRF in `web/lib/aggregator.ts`
  fuses the remaining sources as if Cosine simply had nothing to say —
  which is the truth.
- Positive: Phase 2 makes at most one extra Cosine call (the reversed
  query) instead of two, marginally tightening the cold-path latency
  envelope.
- Positive: removes the last unvalidated Cosine expansion path; consistent
  with ADR-0022.
- Negative: searches where the queried track is missing from Cosine but the
  *artist* is present lose the "style-adjacent for this artist" supplement
  Cosine used to add. In practice those tracks were seeded off whatever the
  fuzzy search ranked first, so the supplement was unreliable; YTM/Yandex/
  Last.fm/trackid still contribute.
- Negative: the search-response cache invalidates on the `v6` → `v7` bump;
  the next search per (artist, track) pair pays the cold Python cost.

**Alternatives considered:**
- **Tighten the seed gate to validate bare-artist queries instead of
  removing the fallback.** Rejected — there is nothing to validate "Artist"
  against (no title component), and the legitimate artist-only search mode
  (`_find_by_artist_only`) depends on the gate accepting bare-artist
  queries. The right scope of the bare-artist Cosine query is "the user
  asked for an artist", not "a track lookup missed".
- **Keep the artist-only fallback but only when the artist itself
  validates against Cosine's `/v1/search` hit.** Rejected — that is the
  same unvalidated guess wearing a thin coat; ADR-0022 says stop adding
  these. If a user wants artist-similar tracks they can search the artist.
- **Drop the reversed-query retry too (Phase 1 only).** Rejected — the
  reversed query targets the *same track* and is gated; it is the cheap,
  correct way to tolerate "Track – Artist" input order. Removing it would
  regress a legitimate case to fix an unrelated one.

**Revisit when:**
Cosine.club exposes an explicit "is this track in the catalogue" lookup, or
a similarity endpoint keyed on artist that returns a confidence the gate can
use — at that point an artist-level Cosine contribution could be re-added
with a real relevance signal behind it rather than fuzzy-search luck.
