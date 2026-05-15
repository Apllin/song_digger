# @trackdigger/python-service

## 0.2.0-rc.0

### Minor Changes

- f6d8047: Add trainer feedback system and ML-based per-source RRF weight learning
- d880932: Player gains a paginated playlist extender so the search queue continues across page boundaries; unplayable tracks now auto-skip via onEnded. Seed search in cosine/yandex/ytm now requires an exact title match for "Artist - Title" queries and falls back to artist-only matching for bare-artist queries, dropping the source when no candidate qualifies.

### Patch Changes

- 1568bbb: Fix SoundCloud title noise (PREMIERE/FREE DL prefixes, catalog and label suffixes) and add artist-only query support
- 3603750: Fix SoundCloud results leaking the queried track itself — the `/recommended` page links back to the seed via its player widget, so the seed is now excluded from the parsed results.

## 0.1.0

### Minor Changes

- bb28e32: Remove the Bandcamp `/similar` adapter ahead of a SoundCloud replacement (stage 2). The Python adapter, the `bandcamp` `SourceList` slot, the Phase 2 artist fallback, smoke/speed tests, and `SEARCH_CACHE_VERSION` (bumped `v5` → `v6`) are gone. The web-side Bandcamp scraper + mp3-extraction player path is kept as the YTM-fallback branch in `embed-resolver.ts`, so non-YTM tracks that YTM exact-match can't resolve still get a chance at inline playback before falling through to "unavailable". See ADR-0023.

### Patch Changes

- 4eccf2d: Fix Cosine.club results when the queried track isn't in its catalogue. The `/similar` route no longer falls back to a bare-artist Cosine query when the "Artist - Track" (and reversed "Track - Artist") lookups don't resolve to a confident seed — a bare-artist query bypasses the adapter's seed-relevance gate, so it accepted whatever Cosine's fuzzy search returned and recommended off an unrelated seed. Now Cosine simply contributes nothing in that case. The reversed-order retry stays. `SEARCH_CACHE_VERSION` bumped `v6` → `v7`. See ADR-0024.
- da3c5a8: Migrate the web `/api/*` layer to a single Hono app and the web→python calls to the kubb-generated client. Internal architecture only — same URLs, same JSON shapes, same anonymous-limit semantics for callers.
- 29bf824: Add per-request cost instrumentation (RequestMetric table populated by Hono middleware + Prisma extension + FastAPI middleware), batch TrackEmbed cache lookups in the search worker, and refactor label-releases to a server-side full sorted+deduped list with lazy per-page client fetching.
- 1a6f951: Discography page now paginates through Discogs server-side instead of preloading the full discography. Filtering by Main role and sorting by year are delegated to Discogs via native query params, so artists with hundreds of releases render the first page in one round-trip instead of waiting for every page to fan out in parallel.
- 622a080: Migrate web data fetching to TanStack Query (favorites, dislikes, search polling, autocomplete on discography/labels/home). Move Discogs artist-release dedup, year sort, and Main-role filter into the Python service so a single request returns the full sorted list, fixing both the chronological-order break across pages and the duplicate `/api/discography/search` request from the Search button.
