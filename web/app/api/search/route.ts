import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchSimilarTracks } from "@/lib/python-client";
import { aggregateTracks, normalizeArtist, normalizeTitle } from "@/lib/aggregator";
import { parseQuery } from "@/lib/parse-query";
import type { SourceList, TrackMeta } from "@/lib/python-client";

const SearchRequestSchema = z.object({
  input: z.string().min(1).max(500),
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

  const { input } = parsed.data;
  const { artist, track } = parseQuery(input);

  const searchQuery = await prisma.searchQuery.create({
    data: { input, status: "running" },
  });

  runSearch(searchQuery.id, input, artist, track).catch((err) => {
    console.error(`[Search] background error for ${searchQuery.id}:`, err);
    prisma.searchQuery
      .update({ where: { id: searchQuery.id }, data: { status: "error" } })
      .catch(console.error);
  });

  return Response.json({ id: searchQuery.id, status: "running" });
}

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
            },
            update: {
              // null means the current fetch had no data — don't overwrite a
              // previously stored value. undefined tells Prisma to skip the field.
              coverUrl: t.coverUrl ?? undefined,
              embedUrl: t.embedUrl ?? undefined,
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
}

async function runSearch(
  searchId: string,
  input: string,
  artist: string,
  track: string | null,
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
  const dislikes = await prisma.dislikedTrack.findMany({
    select: { artistKey: true, titleKey: true },
  });
  const dislikedKeys = new Set(
    dislikes.map((d) => `${d.artistKey}|${d.titleKey}`),
  );
  const filteredSourceLists: SourceList[] = pythonResult.source_lists.map((sl) => ({
    source: sl.source,
    tracks: sl.tracks.filter(
      (t) => !dislikedKeys.has(`${normalizeArtist(t.artist)}|${normalizeTitle(t.title)}`),
    ),
  }));

  const aggregated = aggregateTracks(filteredSourceLists);
  await saveTracks(searchId, aggregated);

  await prisma.searchQuery.update({
    where: { id: searchId },
    data: { status: "done" },
  });
}
