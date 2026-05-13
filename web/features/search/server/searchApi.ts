import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { TrackSourceSchema } from "@/features/player/types";
import type { SearchQueryId } from "@/features/search/schemas";
import {
  SEARCH_PAGE_SIZE,
  searchPageParamSchema,
  searchPageQuerySchema,
  SearchQueryIdSchema,
} from "@/features/search/schemas";
import { PYTHON_LIMIT_PER_SOURCE, SEARCH_CACHE_TTL_SECONDS, searchCacheKey } from "@/features/search/searchCache";
import type { FusedCandidate } from "@/lib/aggregator";
import { aggregateTracks } from "@/lib/aggregator";
import { enrichMissingCovers } from "@/lib/cover-enrichment";
import { warmEmbedCache } from "@/lib/embed-cache";
import { anonGate } from "@/lib/hono/anonGate";
import { HttpError } from "@/lib/hono/httpError";
import type { AppEnv } from "@/lib/hono/types";
import { parseQuery } from "@/lib/parse-query";
import { prisma } from "@/lib/prisma";
import { findSimilar } from "@/lib/python-api/generated/clients/findSimilar";

const SearchBodySchema = z.object({
  input: z.string().trim().min(1).max(500),
});

// Backfill update has to wait for slow-DB days. Cap loose enough to not mask
// real hangs but high enough to survive a cold Neon connection.
const DB_TXN_TIMEOUT_MS = 30_000;

const QUERY_CACHE_TTL_MS = SEARCH_CACHE_TTL_SECONDS * 1000;

function uniqueSources(t: FusedCandidate): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of t.appearances) {
    if (seen.has(a.source)) continue;
    seen.add(a.source);
    out.push(a.source);
  }
  return out;
}

// Reads one page of a completed search straight from the persisted
// SearchResult rows. The full fused+enriched list lives in Postgres after
// `runSearch` (or a previous cache-fill), so paging is a cheap skip/take —
// no Python fan-out, no re-fusion. Ordering pins `id` as a tiebreaker so a
// row never straddles a page boundary across requests. Dislike filtering is
// applied client-side over the returned page; this stays user-agnostic so the
// page is shareable/cacheable.
async function fetchSearchPage(searchId: SearchQueryId, page: number, perPage: number) {
  const where = { searchQueryId: searchId };
  const [items, rows] = await Promise.all([
    prisma.searchResult.count({ where }),
    prisma.searchResult.findMany({
      where,
      orderBy: [{ score: "desc" }, { id: "asc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: { track: true },
    }),
  ]);

  return {
    tracks: rows.map((r) => ({
      ...r.track,
      source: TrackSourceSchema.safeParse(r.track.source).data ?? null,
      score: r.score,
      sources: r.sources.length ? r.sources : [r.track.source],
    })),
    pagination: {
      page,
      pages: Math.max(1, Math.ceil(items / perPage)),
      per_page: perPage,
      items,
    },
  };
}

async function saveTracks(searchId: SearchQueryId, tracks: FusedCandidate[]): Promise<void> {
  if (!tracks.length) return;

  const urls = tracks.map((t) => t.sourceUrl);

  // 1. Bulk insert any new Track rows in a single statement. `skipDuplicates`
  //    collapses upsert-per-row into one round-trip; existing rows aren't
  //    touched here — backfill is handled in step 3 only when needed.
  await prisma.track.createMany({
    data: tracks.map((t) => ({
      title: t.title,
      artist: t.artist,
      source: t.source,
      sourceUrl: t.sourceUrl,
      coverUrl: t.coverUrl,
      embedUrl: t.embedUrl,
    })),
    skipDuplicates: true,
  });

  // 2. One SELECT to map every sourceUrl → id (covers freshly inserted and
  //    pre-existing rows alike) and to read current cover/embed for the
  //    backfill check.
  const existing = await prisma.track.findMany({
    where: { sourceUrl: { in: urls } },
    select: { id: true, sourceUrl: true, coverUrl: true, embedUrl: true },
  });
  const urlToRow = new Map(existing.map((r) => [r.sourceUrl, r]));

  // 3. Backfill cover/embed only when DB stores NULL but the current fetch has
  //    data — preserves the previous "later adapter fills missing art without
  //    overwriting good data" behavior. Typically a no-op after the first save.
  const backfills = tracks.filter((t) => {
    const row = urlToRow.get(t.sourceUrl);
    if (!row) return false;
    return (row.coverUrl == null && t.coverUrl != null) || (row.embedUrl == null && t.embedUrl != null);
  });
  if (backfills.length) {
    await prisma.$transaction(
      backfills.map((t) =>
        prisma.track.update({
          where: { sourceUrl: t.sourceUrl },
          data: {
            coverUrl: t.coverUrl ?? undefined,
            embedUrl: t.embedUrl ?? undefined,
          },
        }),
      ),
      { timeout: DB_TXN_TIMEOUT_MS },
    );
  }

  // 4. Bulk insert SearchResult rows. (searchQueryId, trackId) is unique and
  //    score/sources are fixed for that pair within a single search, so
  //    skipDuplicates is the correct semantics — no UPDATE branch needed.
  await prisma.searchResult.createMany({
    data: tracks.map((t) => ({
      searchQueryId: searchId,
      trackId: urlToRow.get(t.sourceUrl)!.id,
      score: t.score ?? null,
      sources: uniqueSources(t),
    })),
    skipDuplicates: true,
  });

  // 5. Warm the embed cache from tracks that already carry an embedUrl.
  //    YTM is the only `/similar` adapter that still populates embedUrl
  //    (ADR-0023 removed Bandcamp from /similar); the Bandcamp embed
  //    surface is now resolved on-demand through /api/embed. Cross-feature
  //    win: a discography click on the same song later hits cache
  //    without a live YTM lookup. Best-effort, never blocks the search
  //    response.
  warmEmbedCache(tracks).catch((err) => console.error("[embed-cache] warm failed:", err));
}

async function runSearch(
  searchId: SearchQueryId,
  input: string,
  artist: string,
  track: string | null,
  pythonServiceUrl: string,
): Promise<{ pythonDurationMs: number; sourcesUsed: string[] }> {
  const pythonStart = performance.now();
  let pythonResult;
  try {
    pythonResult = await findSimilar(
      { input, artist, track, limit_per_source: PYTHON_LIMIT_PER_SOURCE },
      { baseURL: pythonServiceUrl, signal: AbortSignal.timeout(90_000) },
    );
  } catch (err) {
    console.error("[Search] Python stage failed:", err);
    await prisma.searchQuery.update({ where: { id: searchId }, data: { status: "error" } });
    throw new HttpError(503, { message: "Search service unavailable.", cause: err });
  }
  const pythonDurationMs = performance.now() - pythonStart;

  const sourcesUsed = pythonResult.source_lists.filter((x) => x.tracks.length > 0).map((x) => x.source);
  const aggregated = aggregateTracks(pythonResult.source_lists);
  const playable = await enrichMissingCovers(aggregated);
  await saveTracks(searchId, playable);

  await prisma.searchQuery.update({
    where: { id: searchId },
    data: { status: "done" },
  });

  return { pythonDurationMs, sourcesUsed };
}

export const searchApi = new Hono<AppEnv>()
  .post("/search", anonGate, zValidator("json", SearchBodySchema), async (c) => {
    const { input } = c.req.valid("json");
    const { artist, track } = parseQuery(input);
    const cacheKey = searchCacheKey(artist, track);

    // SearchQuery-level cache: reuse the most recent completed search for this
    // (artist, track) pair within the TTL window. Results are user-agnostic
    // (no dislike filtering server-side), so sharing across users is safe.
    const cutoff = new Date(Date.now() - QUERY_CACHE_TTL_MS);
    const cachedQuery = await prisma.searchQuery.findFirst({
      where: { cacheKey, status: "done", createdAt: { gte: cutoff } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (cachedQuery) {
      const m = c.var.metrics;
      if (m) m.cacheHit = true;
      const id = SearchQueryIdSchema.parse(cachedQuery.id);
      const { tracks, pagination } = await fetchSearchPage(id, 1, SEARCH_PAGE_SIZE);
      return c.json({ id, tracks, pagination });
    }

    // Cache miss — run the full pipeline.
    const searchQuery = await prisma.searchQuery.create({
      data: { input, cacheKey, status: "running" },
    });
    const searchQueryId = SearchQueryIdSchema.parse(searchQuery.id);

    const { pythonDurationMs, sourcesUsed } = await runSearch(
      searchQueryId,
      input,
      artist,
      track,
      c.var.pythonServiceUrl,
    );
    const m = c.var.metrics;
    if (m) {
      m.cacheHit = false;
      m.pythonDurationMs = pythonDurationMs;
      m.sourcesUsed = sourcesUsed;
    }
    const { tracks, pagination } = await fetchSearchPage(searchQueryId, 1, SEARCH_PAGE_SIZE);
    return c.json({ id: searchQueryId, tracks, pagination });
  })
  .get(
    "/search/:id",
    zValidator("param", searchPageParamSchema),
    zValidator("query", searchPageQuerySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { page, perPage } = c.req.valid("query");
      const { tracks, pagination } = await fetchSearchPage(id, page, perPage);
      return c.json({ id, tracks, pagination });
    },
  );
