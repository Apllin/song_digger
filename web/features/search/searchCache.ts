import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";

// Single cache layer for the search pipeline: the completed `SearchQuery` row.
//
//   Keyed by `cacheKey` on `SearchQuery`. On a hit the full fused+persisted
//   track list is returned directly from Postgres (its `SearchResult` rows),
//   skipping the Python `/similar` fan-out, RRF, and the per-source resolve
//   steps. Results are user-agnostic (dislike filtering happens client-side
//   over the returned page), so sharing across users is safe. TTL = 14 days
//   (QUERY_CACHE_TTL_MS in searchApi.ts).
//
// Because a hit serves the *persisted* rows in their *persisted* order, the
// key is versioned: bump `SEARCH_CACHE_VERSION` for ANYTHING that should change
// a result for a given (artist, track) — adding/removing an adapter, changing
// filtering/source ordering in `similar.py`, modifying any adapter's
// `find_similar()` shape, changing `limit_per_source`, or changing the
// aggregator (RRF formula, tiebreaker, artist diversification — i.e. the
// persisted order). The version is part of `cacheKey`, so bumping forces fresh
// keys with no SQL flush. Cover enrichment is NOT a trigger — covers are
// resolved client-side and are not part of the cached result.
export const SEARCH_CACHE_VERSION = "v15"; // v15: added Troi (lb-radio) source; abandon DB-outage degraded results; persisted ordering carries diversification rank
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
