import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import {
  PYTHON_LIMIT_PER_SOURCE,
  SEARCH_CACHE_SOURCE,
  SEARCH_CACHE_TTL_SECONDS,
  searchCacheKey,
} from "@/features/search/searchCache";
import type { FusedCandidate } from "@/lib/aggregator";
import { aggregateTracks, normalizeArtist, normalizeTitle } from "@/lib/aggregator";
import { auth } from "@/lib/auth";
import { enrichMissingCovers } from "@/lib/cover-enrichment";
import { lookupEmbedCache, upsertEmbedCache, warmEmbedCache } from "@/lib/embed-cache";
import { resolveEmbed } from "@/lib/embed-resolver";
import { lookupCache, upsertCache } from "@/lib/external-api-cache";
import { anonGate } from "@/lib/hono/anonGate";
import type { AppEnv } from "@/lib/hono/types";
import { parseQuery } from "@/lib/parse-query";
import { prisma } from "@/lib/prisma";
import { findSimilar } from "@/lib/python-api/generated/clients/findSimilar";
import type { SimilarResponse } from "@/lib/python-api/generated/types/SimilarResponse";
import type { SourceList } from "@/lib/python-api/generated/types/SourceList";

const SearchBodySchema = z.object({
  input: z.string().trim().min(1).max(500),
});

// Backfill update has to wait for slow-DB days. Cap loose enough to not mask
// real hangs but high enough to survive a cold Neon connection.
const DB_TXN_TIMEOUT_MS = 30_000;

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

async function saveTracks(searchId: string, tracks: FusedCandidate[]): Promise<void> {
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

  // 5. Warm the embed cache from tracks that already carry an embedUrl
  //    (YTM/Bandcamp adapters set it during /similar). Cross-feature win:
  //    a discography click on the same song later hits cache without a
  //    live YTM lookup. Best-effort, never blocks the search response.
  warmEmbedCache(tracks).catch((err) => console.error("[embed-cache] warm failed:", err));
}

// BottomPlayer plays youtube_music and bandcamp directly; yandex tracks fall
// through to /api/embed which does a live YTM-exact + Bandcamp-fallback
// lookup. Run that lookup at search time for any yandex track no other source
// confirmed, drop the ones that resolve to nothing, and write the embed cache
// so the eventual click is just a Postgres select.
async function dropUnplayableYandex(candidates: FusedCandidate[]): Promise<FusedCandidate[]> {
  const checks = candidates.map(async (t) => {
    if (t.source !== "yandex_music") return t;
    if (t.appearances.some((a) => a.source === "youtube_music" || a.source === "bandcamp")) {
      return t;
    }

    const cached = await lookupEmbedCache(t.artist, t.title).catch(() => null);
    if (cached) return cached.embedUrl ? t : null;

    const resolved = await resolveEmbed(t.title, t.artist).catch(() => null);
    if (!resolved) return null;

    upsertEmbedCache(t.artist, t.title, {
      embedUrl: resolved.embedUrl,
      source: resolved.source,
      sourceUrl: resolved.sourceUrl ?? null,
      coverUrl: resolved.coverUrl ?? null,
    }).catch((err) => console.error("[embed-cache] upsert failed:", err));

    return resolved.embedUrl ? t : null;
  });

  const settled = await Promise.all(checks);
  return settled.filter((t): t is FusedCandidate => t !== null);
}

async function runSearch(
  searchId: string,
  input: string,
  artist: string,
  track: string | null,
  userId: string | null,
  pythonServiceUrl: string,
) {
  // ── Look up cache + load dislikes in parallel. ───────────────────────────
  // Cache lookup is one Postgres SELECT (~30-80ms RTT to Neon); dislikes is
  // another. Parallelism saves one round-trip worth of wall-clock. On a hit
  // we skip the 3-8s Python fan-out entirely.
  const cacheKey = searchCacheKey(artist, track);
  const [cached, dislikes] = await Promise.all([
    lookupCache<SimilarResponse>(SEARCH_CACHE_SOURCE, cacheKey, SEARCH_CACHE_TTL_SECONDS),
    userId
      ? prisma.dislikedTrack.findMany({
          where: { userId },
          select: { artistKey: true, titleKey: true },
        })
      : Promise.resolve([] as { artistKey: string; titleKey: string }[]),
  ]);

  let pythonResult: SimilarResponse | null;
  if (cached) {
    pythonResult = cached;
  } else {
    pythonResult = await findSimilar(
      { input, artist, track, limit_per_source: PYTHON_LIMIT_PER_SOURCE },
      { baseURL: pythonServiceUrl, signal: AbortSignal.timeout(90_000) },
    ).catch((err: unknown) => {
      console.error("[Search] Python stage failed:", err);
      return null;
    });
    // Best-effort cache write: only on a real Python response. Errors / null
    // results don't poison the cache — next request retries live.
    if (pythonResult) {
      upsertCache(SEARCH_CACHE_SOURCE, cacheKey, pythonResult).catch((err) =>
        console.error("[search-cache] upsert failed:", err),
      );
    }
  }

  if (!pythonResult) {
    await prisma.searchQuery.update({
      where: { id: searchId },
      data: { status: "error" },
    });
    return;
  }

  // Server-side dislike filter: drop tracks whose (artistKey, titleKey)
  // identity is in DislikedTrack before fusion. Filtering at the source-list
  // level (not post-fusion) means a disliked track from one source can't pull
  // in RRF contribution from another source's copy.
  const dislikedKeys = new Set(dislikes.map((d) => `${d.artistKey}|${d.titleKey}`));
  const filteredSourceLists: SourceList[] = pythonResult.source_lists.map((sl) => ({
    source: sl.source,
    tracks: sl.tracks.filter((t) => !dislikedKeys.has(`${normalizeArtist(t.artist)}|${normalizeTitle(t.title)}`)),
  }));

  const aggregated = aggregateTracks(filteredSourceLists);
  const playable = await dropUnplayableYandex(aggregated);

  await enrichMissingCovers(playable);
  await saveTracks(searchId, playable);

  await prisma.searchQuery.update({
    where: { id: searchId },
    data: { status: "done" },
  });
}

export const searchApi = new Hono<AppEnv>()
  .post("/search", anonGate, zValidator("json", SearchBodySchema), async (c) => {
    const { input } = c.req.valid("json");
    const { artist, track } = parseQuery(input);

    // Capture the user at request time. runSearch is fire-and-forget on
    // a background task, so we resolve the session here and pass userId
    // through. Anonymous users get an empty dislike set (no filtering).
    const session = await auth();
    const userId = session?.user?.id ?? null;

    const searchQuery = await prisma.searchQuery.create({
      data: { input, status: "running" },
    });

    const pythonServiceUrl = c.var.pythonServiceUrl;
    runSearch(searchQuery.id, input, artist, track, userId, pythonServiceUrl).catch((err) => {
      console.error(`[Search] background error for ${searchQuery.id}:`, err);
      prisma.searchQuery.update({ where: { id: searchQuery.id }, data: { status: "error" } }).catch(console.error);
    });

    return c.json({ id: searchQuery.id, status: "running" as const });
  })
  .get("/search/:id", async (c) => {
    const id = c.req.param("id");
    const searchQuery = await prisma.searchQuery.findUnique({
      where: { id },
      include: {
        results: {
          orderBy: { score: "desc" },
          include: { track: true },
        },
      },
    });

    if (!searchQuery) {
      return c.json({ error: "Search not found" } as const, 404);
    }

    return c.json({
      id: searchQuery.id,
      status: searchQuery.status,
      tracks: searchQuery.results.map((r) => ({
        ...r.track,
        score: r.score,
        // Multiple adapter sources can surface the same identity; the chip-row
        // in the UI renders one chip per entry. Old SearchResult rows from
        // before this column existed default to [] — UI falls back to [source].
        sources: r.sources.length ? r.sources : [r.track.source],
      })),
    });
  });
