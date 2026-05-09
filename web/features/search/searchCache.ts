import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";

// Caches the Python `/similar` response (SourceList[]) for repeat searches of
// the same (artist, track) pair. The dominant cost in the search pipeline is
// the Python adapter fan-out (Cosine + YTM-radio + Yandex are unavoidable
// 3-8s); RRF + saveTracks are sub-second. Caching the upstream response
// short-circuits the heavy part while RRF and dislike filter still run fresh
// per request, so cross-user cache sharing is correctness-safe.
//
// TTL = 14 days. Source data drift (new tracks on Cosine/YTM) within 2 weeks
// is small for the underground-techno catalogue.
//
// **When to bump SEARCH_CACHE_VERSION:** ANYTHING that changes what Python
// `/similar` returns. That includes: adding/removing an adapter from the
// fan-out in `python-service/app/api/routes/similar.py`, changing filtering
// or source ordering inside that route, modifying any adapter's
// `find_similar()` shape or ordering, or changing `limit_per_source` /
// request shape. Bumping the version means old keys are never read again —
// no SQL flush.
//
// **Does NOT need a bump:** changes to `lib/aggregator.ts` (RRF formula,
// tiebreaker, artist diversification), the dislike filter, cover enrichment,
// or any saveTracks logic. All of these run fresh on every request and
// re-process the cached `source_lists`.
export const SEARCH_CACHE_SOURCE = "search_response";
export const SEARCH_CACHE_VERSION = "v5";
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
