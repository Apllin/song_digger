import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";
import { prisma } from "@/lib/prisma";

export interface EmbedCacheEntry {
  embedUrl: string | null;
  source: string | null;
  sourceUrl: string | null;
  coverUrl: string | null;
}

// Discogs disambiguates duplicate artist names with " (N)" — strip before
// keying so "Voicex (2)" and "Voicex" share a cache entry. Mirrors
// embed-resolver.ts:cleanArtist.
function cleanArtist(artist: string): string {
  return artist.replace(/\s*\(\d+\)\s*$/, "").trim();
}

export interface CacheKey {
  artistKey: string;
  titleKey: string;
}

export function embedCacheKey(artist: string, title: string): CacheKey {
  return {
    artistKey: normalizeArtist(cleanArtist(artist)),
    titleKey: normalizeTitle(title),
  };
}

// Negative-hit TTL: tracks not found on YTM/Bandcamp may get uploaded later,
// so re-resolve after this window. Positive hits never expire.
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isStaleNegative(row: { embedUrl: string | null; updatedAt: Date }): boolean {
  if (row.embedUrl != null) return false;
  return Date.now() - row.updatedAt.getTime() > NEGATIVE_TTL_MS;
}

/**
 * Look up a cached embed for a track.
 *
 * Returns:
 *   - the cached entry on a fresh hit (positive, or negative within 7 days)
 *   - null on miss OR on stale negative — caller should re-resolve.
 *
 * The empty-key guard (artistKey === "" || titleKey === "") matches the
 * behavior of normalize* on degenerate input. We never write empty keys,
 * so we never read them either.
 */
export async function lookupEmbedCache(artist: string, title: string): Promise<EmbedCacheEntry | null> {
  const { artistKey, titleKey } = embedCacheKey(artist, title);
  if (!artistKey || !titleKey) return null;

  const row = await prisma.trackEmbed.findUnique({
    where: { artistKey_titleKey: { artistKey, titleKey } },
    select: {
      embedUrl: true,
      source: true,
      sourceUrl: true,
      coverUrl: true,
      updatedAt: true,
    },
  });

  if (!row) return null;
  if (isStaleNegative(row)) return null;

  return {
    embedUrl: row.embedUrl,
    source: row.source,
    sourceUrl: row.sourceUrl,
    coverUrl: row.coverUrl,
  };
}

/**
 * Persist a resolution result. Both positive and negative outcomes are
 * stored — negative entries get refreshed after NEGATIVE_TTL_MS via the
 * stale check on the read path.
 *
 * `updatedAt` is bumped on every upsert (Prisma @updatedAt), which is what
 * the negative-TTL check keys off, so a stale-negative re-resolution that
 * still returns null correctly resets the 7-day window.
 */
export async function upsertEmbedCache(artist: string, title: string, result: EmbedCacheEntry): Promise<void> {
  const { artistKey, titleKey } = embedCacheKey(artist, title);
  if (!artistKey || !titleKey) return;

  await prisma.trackEmbed.upsert({
    where: { artistKey_titleKey: { artistKey, titleKey } },
    create: {
      artistKey,
      titleKey,
      embedUrl: result.embedUrl,
      source: result.source,
      sourceUrl: result.sourceUrl,
      coverUrl: result.coverUrl,
    },
    update: {
      embedUrl: result.embedUrl,
      source: result.source,
      sourceUrl: result.sourceUrl,
      coverUrl: result.coverUrl,
    },
  });
}

function keyString(k: CacheKey): string {
  return `${k.artistKey}|${k.titleKey}`;
}

/**
 * Batch version of lookupEmbedCache: one `findMany` instead of N findUniques.
 * Returns a map keyed by `${artistKey}|${titleKey}` — caller computes the key
 * via `embedCacheKey()` to look up. Missing key = cache miss OR stale negative
 * (caller should re-resolve). Present key with `embedUrl=null` = fresh
 * negative hit (caller should drop the track without re-resolving).
 *
 * One round-trip to Neon for the whole batch — replaces the previous N
 * sequential findUnique calls in `dropUnplayableYandex` which dominated
 * search latency at ~20 yandex tracks per result set.
 */
export async function lookupEmbedCacheBatch(
  tracks: Array<{ artist: string; title: string }>,
): Promise<Map<string, EmbedCacheEntry>> {
  const keys = tracks.map((t) => embedCacheKey(t.artist, t.title)).filter((k) => k.artistKey && k.titleKey);
  if (!keys.length) return new Map();

  const rows = await prisma.trackEmbed.findMany({
    where: {
      OR: keys.map((k) => ({ artistKey: k.artistKey, titleKey: k.titleKey })),
    },
    select: {
      artistKey: true,
      titleKey: true,
      embedUrl: true,
      source: true,
      sourceUrl: true,
      coverUrl: true,
      updatedAt: true,
    },
  });

  const out = new Map<string, EmbedCacheEntry>();
  for (const row of rows) {
    if (isStaleNegative(row)) continue;
    out.set(keyString({ artistKey: row.artistKey, titleKey: row.titleKey }), {
      embedUrl: row.embedUrl,
      source: row.source,
      sourceUrl: row.sourceUrl,
      coverUrl: row.coverUrl,
    });
  }
  return out;
}

/**
 * Batch version of upsertEmbedCache: collapses N upserts into one interactive
 * transaction, which on Postgres means one round-trip instead of N. Same
 * write semantics as the single-shot version — every entry gets `updatedAt`
 * bumped, which resets the negative-TTL window for stale-negative refreshes.
 *
 * 30s timeout matches `saveTracks`. At ~20 upserts per call this completes
 * in well under a second; the headroom is for slow-DB days, not normal load.
 */
export async function upsertEmbedCacheBatch(
  entries: Array<{ artist: string; title: string; result: EmbedCacheEntry }>,
): Promise<void> {
  if (!entries.length) return;

  const ops = entries
    .map((e) => {
      const { artistKey, titleKey } = embedCacheKey(e.artist, e.title);
      if (!artistKey || !titleKey) return null;
      return prisma.trackEmbed.upsert({
        where: { artistKey_titleKey: { artistKey, titleKey } },
        create: {
          artistKey,
          titleKey,
          embedUrl: e.result.embedUrl,
          source: e.result.source,
          sourceUrl: e.result.sourceUrl,
          coverUrl: e.result.coverUrl,
        },
        update: {
          embedUrl: e.result.embedUrl,
          source: e.result.source,
          sourceUrl: e.result.sourceUrl,
          coverUrl: e.result.coverUrl,
        },
      });
    })
    .filter((op): op is NonNullable<typeof op> => op !== null);

  if (!ops.length) return;
  await prisma.$transaction(ops, { timeout: 30_000 });
}

/**
 * Bulk-warm the cache from search results that already carry an embedUrl
 * (YTM/Bandcamp adapters populate it during /similar). Skips entries with
 * no embed — we don't write negatives speculatively, only on a real failed
 * lookup. Existing rows are not overwritten: a freshly resolved entry from
 * /api/embed shouldn't be clobbered by a stale search result.
 */
export async function warmEmbedCache(
  tracks: Array<{
    artist: string;
    title: string;
    embedUrl?: string | null;
    sourceUrl?: string | null;
    source?: string | null;
    coverUrl?: string | null;
  }>,
): Promise<void> {
  const rows = tracks
    .filter((t) => t.embedUrl)
    .map((t) => {
      const { artistKey, titleKey } = embedCacheKey(t.artist, t.title);
      if (!artistKey || !titleKey) return null;
      return {
        artistKey,
        titleKey,
        embedUrl: t.embedUrl ?? null,
        source: t.source ?? null,
        sourceUrl: t.sourceUrl ?? null,
        coverUrl: t.coverUrl ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (!rows.length) return;

  // createMany + skipDuplicates is one round-trip vs. N upserts. Existing
  // entries are preserved (we only fill misses) — matches the Track
  // backfill philosophy in saveTracks().
  await prisma.trackEmbed.createMany({
    data: rows,
    skipDuplicates: true,
  });
}
