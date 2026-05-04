import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchSimilarTracks } from "@/lib/python-client";
import { aggregateTracks, normalizeArtist, normalizeTitle } from "@/lib/aggregator";
import type { FusedCandidate } from "@/lib/aggregator";
import { parseQuery } from "@/lib/parse-query";
import type { SourceList } from "@/lib/python-client";

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
    return (
      (row.coverUrl == null && t.coverUrl != null) ||
      (row.embedUrl == null && t.embedUrl != null)
    );
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
}

async function runSearch(
  searchId: string,
  input: string,
  artist: string,
  track: string | null,
) {
  // ── Fetch from Python + load dislikes in parallel. ───────────────────────
  // Per-adapter timeouts inside Python keep slow sources (Bandcamp 4s,
  // trackid 9s) from blocking the response. The dislikes query is independent
  // of Python output, so we kick it off concurrently to save one DB round-trip
  // worth of wall-clock latency.
  const [pythonResult, dislikes] = await Promise.all([
    fetchSimilarTracks({
      input,
      artist,
      track,
      limit_per_source: 40,
    }).catch((err) => {
      console.error("[Search] Python stage failed:", err);
      return null;
    }),
    prisma.dislikedTrack.findMany({
      select: { artistKey: true, titleKey: true },
    }),
  ]);

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
