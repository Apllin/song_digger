import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchSimilarTracks } from "@/lib/python-client";
import { aggregateTracks, type SearchFilters, type TrackFeedback } from "@/lib/aggregator";
import { parseQuery } from "@/lib/parse-query";
import type { TrackMeta } from "@/lib/python-client";

const FeedbackTrackSchema = z.object({
  bpm: z.number().nullable().optional(),
  key: z.string().nullable().optional(),
  energy: z.number().nullable().optional(),
  artist: z.string(),
});

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
      liked: z.array(FeedbackTrackSchema),
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

async function saveTracks(searchId: string, tracks: TrackMeta[]): Promise<void> {
  if (!tracks.length) return;

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
        )
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
        })
      )
    )
  );
}

async function runSearch(
  searchId: string,
  input: string,
  artist: string,
  track: string | null,
  filters: SearchFilters
) {
  // ── Fetch from Python (Cosine.club + YTM + Bandcamp "you may also like") ───
  // Bandcamp runs inside Python with a 4s timeout so it never blocks the response.
  const pythonResult = await fetchSimilarTracks({
    input,
    artist,
    track,
    sources: ["youtube_music", "cosine_club"],
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

  const aggregated = aggregateTracks(
    pythonResult.tracks,
    filters,
    sourceBpm,
    sourceKey,
    pythonResult.source_energy,
  );
  await saveTracks(searchId, aggregated);

  await prisma.searchQuery.update({
    where: { id: searchId },
    data: {
      status: "done",
      sourceBpm: sourceBpm ?? undefined,
      sourceKey: sourceKey ?? undefined,
    },
  });
}
