import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchSimilarTracks } from "@/lib/python-client";
import { aggregateTracks, type FusedCandidate, type SearchFilters, type TrackFeedback } from "@/lib/aggregator";
import { parseQuery } from "@/lib/parse-query";
import { enqueueBackgroundEnrich } from "@/lib/enrichment-queue";
import type { SimilarResponse, SourceList, TrackMeta } from "@/lib/python-client";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

// Must match python-service INLINE_BUDGET — tracks beyond this index were
// not enriched inline and become candidates for the background queue.
const INLINE_BUDGET = 6;

/**
 * For each Python track, fill BPM/key/energy/genre/label from the Track row
 * if Python didn't return one. Cache loses to Python on non-null values
 * (cosine results are fresh; older Postgres rows may be stale).
 */
async function hydrateFromCache(tracks: TrackMeta[]): Promise<TrackMeta[]> {
  if (!tracks.length) return tracks;

  const cached = await prisma.track.findMany({
    where: { sourceUrl: { in: tracks.map((t) => t.sourceUrl) } },
    select: {
      sourceUrl: true,
      bpm: true,
      key: true,
      energy: true,
      genre: true,
      label: true,
    },
  });
  const cacheMap = new Map(cached.map((c) => [c.sourceUrl, c]));

  return tracks.map((t) => {
    const c = cacheMap.get(t.sourceUrl);
    if (!c) return t;
    return {
      ...t,
      bpm: t.bpm ?? c.bpm ?? undefined,
      key: t.key ?? c.key ?? undefined,
      energy: t.energy ?? c.energy ?? undefined,
      genre: t.genre ?? c.genre ?? undefined,
      label: t.label ?? c.label ?? undefined,
    };
  });
}

const SearchRequestSchema = z.object({
  input: z.string().min(1).max(500),
  filters: z
    .object({
      bpmMin: z.number().optional(),
      bpmMax: z.number().optional(),
      key: z.string().optional(),
      genre: z.string().optional(),
    })
    .optional(),
  feedback: z
    .object({
      disliked: z.array(z.object({ artist: z.string() })),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SearchRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { input, filters, feedback } = parsed.data;
  const { artist, track } = parseQuery(input);

  const searchQuery = await prisma.searchQuery.create({
    data: { input, status: "running", filters: filters ?? undefined },
  });

  runSearch(searchQuery.id, input, artist, track, filters ?? {}, feedback).catch((err) => {
    console.error(`[Search] background error for ${searchQuery.id}:`, err);
    prisma.searchQuery
      .update({ where: { id: searchQuery.id }, data: { status: "error" } })
      .catch(console.error);
  });

  return Response.json({ id: searchQuery.id, status: "running" });
}

/**
 * Batch-upsert tracks and their search-result links.
 * Uses prisma.$transaction([]) which sends all queries in ONE round-trip
 * instead of 2×N sequential round-trips.
 */
const DB_CHUNK_SIZE = 50;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Prisma's default $transaction timeout is 5s. A full 50-row Track upsert chunk
// (rich techno metadata, fresh DB rows) overshoots that on a cold cache, killing
// the whole search. 30s leaves headroom for slow-DB days without masking real hangs.
const DB_TXN_TIMEOUT_MS = 30_000;

async function saveTracks(
  searchId: string,
  tracks: TrackMeta[],
): Promise<Map<string, string>> {
  if (!tracks.length) return new Map();

  const trackChunks = chunk(tracks, DB_CHUNK_SIZE);

  // 1. Upsert Track records — all chunks in parallel to cut sequential round-trips
  const chunkResults = await Promise.all(
    trackChunks.map((ch) =>
      prisma.$transaction(
        ch.map((t) =>
          prisma.track.upsert({
            where: { sourceUrl: t.sourceUrl },
            create: {
              title: t.title,
              artist: t.artist,
              source: t.source,
              sourceUrl: t.sourceUrl,
              coverUrl: t.coverUrl,
              embedUrl: t.embedUrl,
              bpm: t.bpm,
              key: t.key,
              energy: t.energy,
              genre: t.genre,
              label: t.label,
            },
            update: {
              // null means the current fetch had no data — don't overwrite a
              // previously stored value. undefined tells Prisma to skip the field.
              coverUrl: t.coverUrl ?? undefined,
              embedUrl: t.embedUrl ?? undefined,
              bpm: t.bpm ?? undefined,
              key: t.key ?? undefined,
              energy: t.energy ?? undefined,
            },
            select: { id: true, sourceUrl: true },
          })
        ),
        { timeout: DB_TXN_TIMEOUT_MS }
      )
    )
  );

  // URL→id map is order-safe regardless of how Promise.all resolves chunks
  const urlToId = new Map(chunkResults.flat().map((s) => [s.sourceUrl, s.id]));

  // 2. Upsert SearchResult records — all chunks in parallel
  await Promise.all(
    trackChunks.map((ch) =>
      prisma.$transaction(
        ch.map((t) => {
          const trackId = urlToId.get(t.sourceUrl)!;
          return prisma.searchResult.upsert({
            where: {
              searchQueryId_trackId: { searchQueryId: searchId, trackId },
            },
            create: {
              searchQueryId: searchId,
              trackId,
              score: t.score ?? null,
            },
            update: { score: t.score ?? null },
          });
        }),
        { timeout: DB_TXN_TIMEOUT_MS }
      )
    )
  );

  // Returned for downstream consumers (feature extraction needs Track ids,
  // which only exist after upsert resolves).
  return urlToId;
}

/**
 * Fire-and-forget POST to python-service /features/extract.
 *
 * Builds the per-candidate payload from the post-aggregation list (so
 * `appearances` carries the source-list facts and `score` carries the RRF
 * value) and the just-persisted track-id map. Failures are caught and
 * logged — the search response must not depend on this call succeeding.
 */
/**
 * Fire-and-forget POST to python-service /features/discogs-fill.
 *
 * Mirrors the C1 /features/extract pattern: never awaited, never thrown,
 * never blocks the user's search response. The Python handler eventually
 * fills `yearProximity` and `artistCorelease` on the same CandidateFeatures
 * rows that /features/extract created. If discogs-fill races ahead and
 * lands first, the UPDATE finds zero rows — the next search re-fires.
 *
 * Per ADR-0013, Discogs is rate-limited and slow; this is the asynchronous
 * leg of Stage C2.
 */
function postDiscogsFill(
  searchId: string,
  aggregated: FusedCandidate[],
  trackIdsByUrl: Map<string, string>,
  pythonResult: SimilarResponse,
): Promise<void> {
  const candidates = aggregated.flatMap((t) => {
    const trackId = trackIdsByUrl.get(t.sourceUrl);
    if (!trackId) return [];
    return [{
      trackId,
      artist: t.artist,
      title: t.title,
    }];
  });

  if (!candidates.length || !pythonResult.source_artist) {
    return Promise.resolve();
  }

  return fetch(`${PYTHON_SERVICE_URL}/features/discogs-fill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      search_query_id: searchId,
      seed_artist: pythonResult.source_artist,
      candidates,
    }),
  })
    .then(() => undefined)
    .catch((err) => {
      console.error("[Search] discogs-fill call failed:", err);
    });
}

function postExtractFeatures(
  searchId: string,
  aggregated: FusedCandidate[],
  trackIdsByUrl: Map<string, string>,
  pythonResult: SimilarResponse,
): Promise<void> {
  const candidates = aggregated.flatMap((t) => {
    const trackId = trackIdsByUrl.get(t.sourceUrl);
    if (!trackId) return []; // saveTracks didn't persist — skip silently
    const appearances = t.appearances ?? [];
    return [{
      trackId,
      bpm: t.bpm ?? null,
      key: t.key ?? null,
      energy: t.energy ?? null,
      label: t.label ?? null,
      genre: t.genre ?? null,
      embedUrl: t.embedUrl ?? null,
      nSources: appearances.length,
      topRank: appearances.length
        ? Math.min(...appearances.map((a) => a.rank))
        : 999,
      rrfScore: t.score ?? t.rrfScore ?? 0,
    }];
  });

  if (!candidates.length) return Promise.resolve();

  return fetch(`${PYTHON_SERVICE_URL}/features/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      search_query_id: searchId,
      seed_bpm: pythonResult.source_bpm,
      seed_key: pythonResult.source_key,
      seed_energy: pythonResult.source_energy,
      seed_label: pythonResult.source_label,
      seed_genre: pythonResult.source_genre,
      candidates,
    }),
  })
    .then(() => undefined)
    .catch((err) => {
      console.error("[Search] feature extraction call failed:", err);
    });
}

async function runSearch(
  searchId: string,
  input: string,
  artist: string,
  track: string | null,
  filters: SearchFilters,
  feedback: TrackFeedback | undefined,
) {
  // ── Fetch from Python — fan out to all enabled adapters in /similar. ─────
  // Per-adapter timeouts inside Python keep slow sources (Bandcamp 4s,
  // trackid 9s) from blocking the response.
  const pythonResult = await fetchSimilarTracks({
    input,
    artist,
    track,
    limit_per_source: 40,
  }).catch((err) => {
    console.error("[Search] Python stage failed:", err);
    return null;
  });

  let sourceBpm: number | null = null;
  let sourceKey: string | null = null;

  if (!pythonResult) {
    await prisma.searchQuery.update({
      where: { id: searchId },
      data: { status: "error" },
    });
    return;
  }

  sourceBpm = pythonResult.source_bpm;
  sourceKey = pythonResult.source_key;

  // Hydrate each source list's tracks from cache before fusion so RRF can
  // merge metadata across sources with the freshest values available.
  const allTracks = pythonResult.source_lists.flatMap((sl) => sl.tracks);
  const hydratedFlat = await hydrateFromCache(allTracks);
  const hydratedByUrl = new Map(hydratedFlat.map((t) => [t.sourceUrl, t]));
  const hydratedLists: SourceList[] = pythonResult.source_lists.map((sl) => ({
    source: sl.source,
    tracks: sl.tracks.map((t) => hydratedByUrl.get(t.sourceUrl) ?? t),
  }));

  const aggregated = aggregateTracks(hydratedLists, filters, feedback);
  const trackIdsByUrl = await saveTracks(searchId, aggregated);

  // Fire-and-forget feature extraction. Failures must not block status="done"
  // — features are observability for Stage D, not user-facing state.
  void postExtractFeatures(searchId, aggregated, trackIdsByUrl, pythonResult);

  // Stage C2: also fire the Discogs fill. Eventually consistent against the
  // C1 rows /features/extract just created. Both calls are independent of
  // the user-visible search response.
  void postDiscogsFill(searchId, aggregated, trackIdsByUrl, pythonResult);

  await prisma.searchQuery.update({
    where: { id: searchId },
    data: {
      status: "done",
      sourceBpm: sourceBpm ?? undefined,
      sourceKey: sourceKey ?? undefined,
    },
  });

  // Background fill: tracks beyond the inline budget that still lack BPM/key.
  // Persists into Track so the next search hits the cache instead of Beatport.
  const toEnrich = aggregated
    .slice(INLINE_BUDGET)
    .filter((t) => t.bpm == null || t.key == null);

  if (toEnrich.length) {
    void enqueueBackgroundEnrich(toEnrich).catch((err) => {
      console.error(`[Search] background enrichment failed for ${searchId}:`, err);
    });
  }
}
