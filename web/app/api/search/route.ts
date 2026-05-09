import { NextRequest } from "next/server";
import { z } from "zod";

import type { FusedCandidate } from "@/lib/aggregator";
import { aggregateTracks, normalizeArtist, normalizeTitle } from "@/lib/aggregator";
import { gateAnonymousRequest } from "@/lib/anonymous-counter";
import { auth } from "@/lib/auth";
import { enrichMissingCovers } from "@/lib/cover-enrichment";
import { lookupEmbedCache, upsertEmbedCache, warmEmbedCache } from "@/lib/embed-cache";
import { resolveEmbed } from "@/lib/embed-resolver";
import { lookupCache, upsertCache } from "@/lib/external-api-cache";
import { parseQuery } from "@/lib/parse-query";
import { prisma } from "@/lib/prisma";
import type { SimilarResponse, SourceList } from "@/lib/python-client";
import { fetchSimilarTracks } from "@/lib/python-client";

const SearchRequestSchema = z.object({
  input: z.string().trim().min(1).max(500),
});

// ── Search response cache ────────────────────────────────────────────────────
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
// request shape in [web/lib/python-client.ts](web/lib/python-client.ts).
// Bumping the version means old keys are never read again — no SQL flush.
//
// **Does NOT need a bump:** changes to `lib/aggregator.ts` (RRF formula,
// tiebreaker, artist diversification), the dislike filter, cover enrichment,
// or any saveTracks logic. All of these run fresh on every request and
// re-process the cached `source_lists`.
const SEARCH_CACHE_SOURCE = "search_response";
const SEARCH_CACHE_VERSION = "v5";
const SEARCH_CACHE_TTL_SECONDS = 14 * 24 * 60 * 60;
const PYTHON_LIMIT_PER_SOURCE = 40;

export function searchCacheKey(artist: string, track: string | null): string {
  // Reuse the same normalization as DislikedTrack identity matching so two
  // typings with the same parsed pair share a cache entry. Sentinel "_" for
  // artist-only search avoids colliding with empty-track variants.
  const a = normalizeArtist(artist);
  const t = track ? normalizeTitle(track) : "_";
  return `${SEARCH_CACHE_VERSION}:${a}|${t}`;
}

export const _internals = {
  SEARCH_CACHE_SOURCE,
  SEARCH_CACHE_VERSION,
  SEARCH_CACHE_TTL_SECONDS,
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SearchRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { input } = parsed.data;
  const { artist, track } = parseQuery(input);

  // Capture the user at request time. runSearch is fire-and-forget on
  // a background task, so we resolve the session here and pass userId
  // through. Anonymous users get an empty dislike set (no filtering).
  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Anonymous users get 10 free requests pooled across search +
  // discography + labels (ADR-0021). Authenticated users bypass.
  if (!userId) {
    const gate = await gateAnonymousRequest();
    if (!gate.ok) {
      return Response.json({ error: "ANONYMOUS_LIMIT_REACHED" }, { status: 429 });
    }
  }

  const searchQuery = await prisma.searchQuery.create({
    data: { input, status: "running" },
  });

  runSearch(searchQuery.id, input, artist, track, userId).catch((err) => {
    console.error(`[Search] background error for ${searchQuery.id}:`, err);
    prisma.searchQuery.update({ where: { id: searchQuery.id }, data: { status: "error" } }).catch(console.error);
  });

  return Response.json({ id: searchQuery.id, status: "running" });
}

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

async function runSearch(searchId: string, input: string, artist: string, track: string | null, userId: string | null) {
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
    pythonResult = await fetchSimilarTracks({
      input,
      artist,
      track,
      limit_per_source: PYTHON_LIMIT_PER_SOURCE,
    }).catch((err) => {
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
