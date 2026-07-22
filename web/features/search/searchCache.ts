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
export const SEARCH_CACHE_VERSION = "v19";
export const SEARCH_CACHE_TTL_SECONDS = 14 * 24 * 60 * 60;
// Per-source ceiling sent to Python `/similar`. lastfm_hop is exempt — it runs
// its own fan-out (HOP_SIMILARS_PER_SEED) and ignores limit_per_source.
export const PYTHON_LIMIT_PER_SOURCE = 15;

function keyPart(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function searchCacheKey(artist: string, track: string | null): string {
  // Minimal key hygiene only (lowercase/trim); canonical title cleaning is the
  // LLM's job server-side. Sentinel "_" keeps artist-only distinct from empty-track.
  const a = keyPart(artist);
  const t = track ? keyPart(track) : "_";
  return `${SEARCH_CACHE_VERSION}:${a}|${t}`;
}
