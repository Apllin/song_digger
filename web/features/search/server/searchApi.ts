import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { resolveAudioFeatures } from "@/features/enrichment/server/resolveAudioFeatures";
import { TrackSourceSchema } from "@/features/player/types";
import type { SearchQueryId } from "@/features/search/schemas";
import {
  SEARCH_PAGE_SIZE,
  searchPageParamSchema,
  searchPageQuerySchema,
  SearchQueryIdSchema,
} from "@/features/search/schemas";
import { PYTHON_LIMIT_PER_SOURCE, SEARCH_CACHE_TTL_SECONDS, searchCacheKey } from "@/features/search/searchCache";
import type { AudioFeatures, FusedCandidate } from "@/lib/aggregator";
import { aggregateTracks, buildFeatures, rrfFuse } from "@/lib/aggregator";
import { enrichMissingCovers } from "@/lib/cover-enrichment";
import { warmEmbedCache } from "@/lib/embed-cache";
import { anonGate } from "@/lib/hono/anonGate";
import { HttpError } from "@/lib/hono/httpError";
import { pythonServiceHeaders } from "@/lib/python-api/headers";
import type { AppEnv } from "@/lib/hono/types";
import { getActiveWeights } from "@/lib/modelWeights";
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

async function saveTracks(
  searchId: SearchQueryId,
  tracks: FusedCandidate[],
  seed: { artist: string; title: string | null },
  audio: AudioFeatures,
  attemptedUrls: Set<string>,
): Promise<void> {
  if (!tracks.length) return;

  const urls = tracks.map((t) => t.sourceUrl);
  const now = new Date();

  // 1. Bulk insert any new Track rows in a single statement. `skipDuplicates`
  //    collapses upsert-per-row into one round-trip; existing rows aren't
  //    touched here — backfill is handled in step 3 only when needed. New rows
  //    carry the eagerly-resolved bpm/key; `audioFeaturesFetchedAt` is stamped
  //    on every scraped row so a fruitless Beatport lookup isn't repeated.
  await prisma.track.createMany({
    data: tracks.map((t) => ({
      title: t.title,
      artist: t.artist,
      source: t.source,
      sourceUrl: t.sourceUrl,
      coverUrl: t.coverUrl,
      embedUrl: t.embedUrl,
      bpm: audio.candidateBpm.get(t.sourceUrl) ?? null,
      musicalKey: audio.candidateMusicalKey.get(t.sourceUrl) ?? null,
      audioFeaturesFetchedAt: attemptedUrls.has(t.sourceUrl) ? now : null,
    })),
    skipDuplicates: true,
  });

  // 2. One SELECT to map every sourceUrl → id (covers freshly inserted and
  //    pre-existing rows alike) and to read current cover/embed/audio state for
  //    the backfill check.
  const existing = await prisma.track.findMany({
    where: { sourceUrl: { in: urls } },
    select: { id: true, sourceUrl: true, coverUrl: true, embedUrl: true, audioFeaturesFetchedAt: true },
  });
  const urlToRow = new Map(existing.map((r) => [r.sourceUrl, r]));

  // 3. Backfill cover/embed when DB stores NULL but the current fetch has data,
  //    and the eagerly-resolved bpm/key for pre-existing rows we scraped this
  //    search (audioFeaturesFetchedAt still NULL). Never overwrites good data.
  //    Typically a no-op after the first save of a given track.
  const backfills = tracks.filter((t) => {
    const row = urlToRow.get(t.sourceUrl);
    if (!row) return false;
    const coverEmbed = (row.coverUrl == null && t.coverUrl != null) || (row.embedUrl == null && t.embedUrl != null);
    // Refresh on every attempt — including a re-attempt of a stale "not found"
    // (timestamp older than `now`) so its cooldown resets. Just-inserted rows
    // already carry `now` from createMany and are skipped here.
    const audioBackfill =
      attemptedUrls.has(t.sourceUrl) && (row.audioFeaturesFetchedAt == null || row.audioFeaturesFetchedAt < now);
    return coverEmbed || audioBackfill;
  });
  if (backfills.length) {
    await prisma.$transaction(
      backfills.map((t) => {
        const row = urlToRow.get(t.sourceUrl)!;
        const audioBackfill =
          attemptedUrls.has(t.sourceUrl) && (row.audioFeaturesFetchedAt == null || row.audioFeaturesFetchedAt < now);
        return prisma.track.update({
          where: { sourceUrl: t.sourceUrl },
          data: {
            coverUrl: t.coverUrl ?? undefined,
            embedUrl: t.embedUrl ?? undefined,
            ...(audioBackfill
              ? {
                  bpm: audio.candidateBpm.get(t.sourceUrl) ?? undefined,
                  musicalKey: audio.candidateMusicalKey.get(t.sourceUrl) ?? undefined,
                  audioFeaturesFetchedAt: now,
                }
              : {}),
          },
        });
      }),
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
      features: buildFeatures(t),
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

  // 6. Persist the eagerly-resolved seed bpm/key on this search row so the
  //    trainer (SearchQuery → SearchResult join) and later searches of the same
  //    seed can read it. Value may be cache-sourced or freshly scraped.
  if (seed.title != null && audio.seedBpm != null) {
    await prisma.searchQuery.update({
      where: { id: searchId },
      data: { seedBpm: audio.seedBpm, seedMusicalKey: audio.seedMusicalKey ?? undefined },
    });
  }
}

function cacheKeyFor(artist: string, track: string | null): string {
  return searchCacheKey(artist, track);
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
      { baseURL: pythonServiceUrl, signal: AbortSignal.timeout(90_000), headers: pythonServiceHeaders() },
    );
  } catch (err) {
    console.error("[Search] Python stage failed:", err);
    await prisma.searchQuery.update({ where: { id: searchId }, data: { status: "error" } });
    throw new HttpError(503, { message: "Search service unavailable.", cause: err });
  }
  const pythonDurationMs = performance.now() - pythonStart;

  const sourcesUsed = pythonResult.source_lists.filter((x) => x.tracks.length > 0).map((x) => x.source);
  const weights = await getActiveWeights();

  // Fuse first to get the deduped candidate set (one row per identity), then
  // eagerly resolve BPM/key for all of them so the audio bonus is applied to
  // the whole list before the final sort — not on a later background pass.
  // aggregateTracks re-fuses deterministically, so candidate sourceUrls align.
  const seed = { artist, title: track };
  const fused = rrfFuse(pythonResult.source_lists, weights);
  const { audio, attemptedUrls } = await resolveAudioFeatures(
    cacheKeyFor(artist, track),
    seed,
    fused,
    pythonServiceUrl,
  );
  const aggregated = aggregateTracks(pythonResult.source_lists, weights, audio);
  const playable = await enrichMissingCovers(aggregated);
  await saveTracks(searchId, playable, seed, audio, attemptedUrls);

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
