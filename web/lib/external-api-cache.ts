import { prisma } from "@/lib/prisma";

/**
 * Generic cache for external-API responses backed by the ExternalApiCache
 * Postgres table. One module on each side of the stack (this one + a Python
 * mirror in app/core/db.py) reads/writes the same table.
 *
 * Design choices:
 *   - Single table for all sources (`source` discriminator + free-form
 *     `cacheKey`). Avoids 8 narrow tables for what is the same shape.
 *   - TTL lives at the call site, not in the row. `lookupCache(..., ttlSeconds)`
 *     decides freshness. A `ttlSeconds` of `undefined` means "never expires"
 *     (Discogs tracklist, iTunes covers).
 *   - Empty payloads (`[]`, `{}`) are valid cache values and distinct from a
 *     row-not-found miss. Callers that want negative caching write
 *     `payload: null` or an empty array; callers that don't (iTunes) just
 *     skip upsert on miss.
 *   - Structured stdout logging on every lookup so we can later grep for
 *     hit-rate / latency without wiring a metrics system. Keep the format
 *     stable — `[cache] HIT|MISS|STALE source=X key=Y ...`.
 */

interface CacheRow {
  payload: unknown;
  updatedAt: Date;
}

function logCacheEvent(
  outcome: "HIT" | "MISS" | "STALE",
  source: string,
  cacheKey: string,
  extra: Record<string, string | number>,
): void {
  const parts = [
    `outcome=${outcome}`,
    `source=${source}`,
    `key=${cacheKey}`,
    ...Object.entries(extra).map(([k, v]) => `${k}=${v}`),
  ];
  console.log(`[cache] ${parts.join(" ")}`);
}

/**
 * Look up a cached payload.
 *
 * @param ttlSeconds  When set, rows older than this are treated as stale and
 *                    return null (forcing the caller to re-resolve and upsert).
 *                    Undefined = no expiry; any existing row is returned.
 *
 * Returns null on miss or stale. Returns the parsed payload on hit (including
 * empty arrays/objects — those are legitimate cache values).
 *
 * Errors are swallowed and logged: a cache outage must never block the caller
 * from making the live external request.
 */
export async function lookupCache<T>(source: string, cacheKey: string, ttlSeconds?: number): Promise<T | null> {
  if (!source || !cacheKey) return null;
  const start = Date.now();
  let row: CacheRow | null;
  try {
    row = await prisma.externalApiCache.findUnique({
      where: { source_cacheKey: { source, cacheKey } },
      select: { payload: true, updatedAt: true },
    });
  } catch (err) {
    console.error(`[cache] lookup failed source=${source} key=${cacheKey}:`, err);
    return null;
  }
  const latencyMs = Date.now() - start;

  if (!row) {
    logCacheEvent("MISS", source, cacheKey, { latency_ms: latencyMs });
    return null;
  }

  if (ttlSeconds != null) {
    const ageS = Math.floor((Date.now() - row.updatedAt.getTime()) / 1000);
    if (ageS > ttlSeconds) {
      logCacheEvent("STALE", source, cacheKey, {
        age_s: ageS,
        ttl_s: ttlSeconds,
        latency_ms: latencyMs,
      });
      return null;
    }
    logCacheEvent("HIT", source, cacheKey, {
      age_s: ageS,
      latency_ms: latencyMs,
    });
  } else {
    logCacheEvent("HIT", source, cacheKey, { latency_ms: latencyMs });
  }

  return row.payload as T;
}

/**
 * Persist a payload. Always overwrites prior content for (source, cacheKey)
 * — Prisma's @updatedAt bump resets the TTL window on every write, which is
 * what callers want (re-resolution after stale should reset the clock).
 */
export async function upsertCache<T>(source: string, cacheKey: string, payload: T): Promise<void> {
  if (!source || !cacheKey) return;
  try {
    await prisma.externalApiCache.upsert({
      where: { source_cacheKey: { source, cacheKey } },
      create: {
        source,
        cacheKey,
        payload: payload as never,
      },
      update: {
        payload: payload as never,
      },
    });
  } catch (err) {
    console.error(`[cache] upsert failed source=${source} key=${cacheKey}:`, err);
  }
}
