import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";

// Two-layer cache for the search pipeline:
//
// Layer 1 — SearchQuery row (final result cache):
//   Keyed by `cacheKey` on `SearchQuery`. On a hit the full fused+enriched
//   track list is returned directly from Postgres, skipping Python, RRF,
//   yandex playability checks, and cover enrichment. Results are
//   user-agnostic (no server-side dislike filtering), so sharing across
//   users is safe. TTL = 14 days (QUERY_CACHE_TTL_MS in searchApi.ts).
//
// Layer 2 — ExternalApiCache (Python response cache):
//   Keyed by `cacheKey` in `ExternalApiCache` with source="search_response".
//   Caches the raw Python `/similar` SourceList[] so on a layer-1 miss the
//   RRF + yandex + cover steps still run fresh but the 3-8s Python fan-out
//   is skipped. TTL = 14 days (SEARCH_CACHE_TTL_SECONDS).
//
// **When to bump SEARCH_CACHE_VERSION:** ANYTHING that changes what Python
// `/similar` returns — adding/removing an adapter, changing filtering or
// source ordering, modifying any adapter's `find_similar()` shape, or
// changing `limit_per_source`. Bumping invalidates both cache layers
// simultaneously (same key prefix). No SQL flush needed.
//
// **Does NOT need a bump:** changes to `lib/aggregator.ts` (RRF formula,
// tiebreaker, artist diversification), cover enrichment, or saveTracks
// logic — these only affect layer-1 misses and run fresh every time.
export const SEARCH_CACHE_SOURCE = "search_response";
export const SEARCH_CACHE_VERSION = "v6";
export const SEARCH_CACHE_TTL_SECONDS = 14 * 24 * 60 * 60;
export const PYTHON_LIMIT_PER_SOURCE = 40;

export function searchCacheKey(artist: string, track: string | null): string {
  // Reuse the same normalization as DislikedTrack identity matching so two
  // typings with the same parsed pair share a cache entry. Sentinel "_" for
  // artist-only search avoids colliding with empty-track variants.
  const a = normalizeArtist(artist);
  const t = track ? normalizeTitle(track) : "_";
  return `${SEARCH_CACHE_VERSION}:${a}|${t}`;
}
