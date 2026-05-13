# @trackdigger/web

## 0.2.0-rc.0

### Minor Changes

- bb28e32: Remove the Bandcamp `/similar` adapter ahead of a SoundCloud replacement (stage 2). The Python adapter, the `bandcamp` `SourceList` slot, the Phase 2 artist fallback, smoke/speed tests, and `SEARCH_CACHE_VERSION` (bumped `v5` → `v6`) are gone. The web-side Bandcamp scraper + mp3-extraction player path is kept as the YTM-fallback branch in `embed-resolver.ts`, so non-YTM tracks that YTM exact-match can't resolve still get a chance at inline playback before falling through to "unavailable". See ADR-0023.

### Patch Changes

- 729fd5b: Replace auth server actions with typed Hono API routes under `/api/auth/*`; sign-out now uses client-side next-auth/react
- 32a0822: Remove EmbedPlayer from discography; route playback through BottomPlayer with useQuery tracklist caching and Jotai open-state persistence
- a5bf361: Discography track lists no longer mis-attribute every track on a release to the searched artist. Discogs only tags a track with its own `artists` when the performer differs from the release's headline artist, so tracks on a release where the searched artist is just a remixer/contributor (`role` = Remix / Appearance / TrackAppearance / Producer) came back with an empty artist list and were stamped with the searched artist's name — which then made the YouTube Music lookup fail and show "no player". The release's headline artist is now carried through (`ArtistRelease.artist` from Discogs → `ArtistRelease.artist` Prisma column → `DiscographyRelease.artist`) and used as the per-track fallback instead.
- 4eccf2d: Fix Cosine.club results when the queried track isn't in its catalogue. The `/similar` route no longer falls back to a bare-artist Cosine query when the "Artist - Track" (and reversed "Track - Artist") lookups don't resolve to a confident seed — a bare-artist query bypasses the adapter's seed-relevance gate, so it accepted whatever Cosine's fuzzy search returned and recommended off an unrelated seed. Now Cosine simply contributes nothing in that case. The reversed-order retry stays. `SEARCH_CACHE_VERSION` bumped `v6` → `v7`. See ADR-0024.
- f72dd38: Discography page now fetches artist releases via React Query (`useArtistReleases` hook). The previous useEffect with manual `AbortController` is gone, paged data is cached so revisiting an artist or page is instant, and previous-page data stays visible while the next page is loading instead of flashing a spinner.
- 4688ae4: Refactor player into sub-components; add arrow-key prev/next shortcuts and media session seek support
- da3c5a8: Migrate the web `/api/*` layer to a single Hono app and the web→python calls to the kubb-generated client. Internal architecture only — same URLs, same JSON shapes, same anonymous-limit semantics for callers.
- 29bf824: Add per-request cost instrumentation (RequestMetric table populated by Hono middleware + Prisma extension + FastAPI middleware), batch TrackEmbed cache lookups in the search worker, and refactor label-releases to a server-side full sorted+deduped list with lazy per-page client fetching.
- a9d2b03: Refactor player into feature folder with adapter pattern and discriminated union types
- 1a6f951: Discography page now paginates through Discogs server-side instead of preloading the full discography. Filtering by Main role and sorting by year are delegated to Discogs via native query params, so artists with hundreds of releases render the first page in one round-trip instead of waiting for every page to fan out in parallel.
- 7d9bd44: Search results and favorites now paginate server-side (skip/take + page/pages/per_page/items metadata) the same way discography and labels do, with the shared `Pagination` component moved to `web/components/Pagination.tsx` and an 18-per-page size shared by both grids.
  - Search pages are read straight from the persisted SearchResult rows via `GET /api/search/:id`, replacing the client-side "Show 18 more" counter. Only disliked tracks are filtered out of a page; favorited tracks stay in place with the heart on their card lit up.
  - New `/favorites` page (with a nav tab) lists saved tracks page by page.
  - Prev/Next keeps the current page visible with a small centered loader instead of blanking the grid.
  - Favoriting is idempotent (`POST /api/favorites` no longer 409s on a re-add, and returns a clean 401 instead of a 500 when the session points at a user that no longer exists).
  - The search bar no longer auto-opens its suggestions dropdown when the page is revisited with a pre-filled query.

- 622a080: Migrate web data fetching to TanStack Query (favorites, dislikes, search polling, autocomplete on discography/labels/home). Move Discogs artist-release dedup, year sort, and Main-role filter into the Python service so a single request returns the full sorted list, fixing both the chronological-order break across pages and the duplicate `/api/discography/search` request from the Search button.
