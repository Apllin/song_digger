import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { PYTHON_LIMIT_PER_SOURCE, SEARCH_CACHE_TTL_SECONDS, searchCacheKey } from "@/features/search/searchCache";
import type { FusedCandidate } from "@/lib/aggregator";
import { aggregateTracks } from "@/lib/aggregator";
import { enrichMissingCovers } from "@/lib/cover-enrichment";
import { warmEmbedCache } from "@/lib/embed-cache";
import { anonGate } from "@/lib/hono/anonGate";
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

async function saveTracks(searchId: string, tracks: FusedCandidate[]): Promise<Map<string, string>> {
  if (!tracks.length) return new Map();

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

  // 5. Warm the embed cache from tracks that already carry an embedUrl
  //    (YTM/Bandcamp adapters set it during /similar). Cross-feature win:
  //    a discography click on the same song later hits cache without a
  //    live YTM lookup. Best-effort, never blocks the search response.
  warmEmbedCache(tracks).catch((err) => console.error("[embed-cache] warm failed:", err));

  return new Map(existing.map((r) => [r.sourceUrl, r.id]));
}

async function runSearch(
  searchId: string,
  input: string,
  artist: string,
  track: string | null,
  pythonServiceUrl: string,
) {
  const pythonStart = performance.now();
  const pythonResult = await findSimilar(
    { input, artist, track, limit_per_source: PYTHON_LIMIT_PER_SOURCE },
    { baseURL: pythonServiceUrl, signal: AbortSignal.timeout(90_000) },
  ).catch((err: unknown) => {
    console.error("[Search] Python stage failed:", err);
    return null;
  });
  const pythonDurationMs = performance.now() - pythonStart;

  if (!pythonResult) {
    await prisma.searchQuery.update({
      where: { id: searchId },
      data: { status: "error" },
    });
    return null;
  }

  const sourcesUsed = pythonResult.source_lists.filter((x) => x.tracks.length > 0).map((x) => x.source);
  const aggregated = aggregateTracks(pythonResult.source_lists);
  const playable = await enrichMissingCovers(aggregated);
  const urlToId = await saveTracks(searchId, playable);

  await prisma.searchQuery.update({
    where: { id: searchId },
    data: { status: "done" },
  });

  return { playable, urlToId, pythonDurationMs, sourcesUsed };
}

export const searchApi = new Hono<AppEnv>().post(
  "/search",
  anonGate,
  zValidator("json", SearchBodySchema),
  async (c) => {
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
      include: {
        results: {
          orderBy: { score: "desc" },
          include: { track: true },
        },
      },
    });

    if (cachedQuery) {
      const m = c.var.metrics;
      if (m) m.cacheHit = true;
      return c.json({
        id: cachedQuery.id,
        tracks: cachedQuery.results.map((r) => ({
          ...r.track,
          score: r.score,
          sources: r.sources.length ? r.sources : [r.track.source],
        })),
      });
    }

    // Cache miss — run the full pipeline.
    const searchQuery = await prisma.searchQuery.create({
      data: { input, cacheKey, status: "running" },
    });

    const pythonServiceUrl = c.var.pythonServiceUrl;
    const result = await runSearch(searchQuery.id, input, artist, track, pythonServiceUrl);

    if (!result) {
      return c.json({ error: "Search service unavailable." } as const, 503);
    }

    const { playable, urlToId, pythonDurationMs, sourcesUsed } = result;
    const m = c.var.metrics;
    if (m) {
      m.cacheHit = false;
      m.pythonDurationMs = pythonDurationMs;
      m.sourcesUsed = sourcesUsed;
    }
    return c.json({
      id: searchQuery.id,
      tracks: playable.map((t) => ({
        id: urlToId.get(t.sourceUrl)!,
        title: t.title,
        artist: t.artist,
        source: t.source,
        sourceUrl: t.sourceUrl,
        coverUrl: t.coverUrl ?? null,
        embedUrl: t.embedUrl ?? null,
        score: t.score ?? null,
        sources: uniqueSources(t),
      })),
    });
  },
);
