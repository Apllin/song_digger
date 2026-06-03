import type { SearchQueryId } from "@/features/search/schemas";
import { prisma } from "@/lib/prisma";
import { enrichAudioFeatures } from "@/lib/python-api/generated/clients/enrichAudioFeatures";
import type { TrackMeta } from "@/lib/python-api/generated/types/TrackMeta";

/**
 * Fire-and-forget Beatport enrichment for the search's seed (stored on
 * SearchQuery) and candidates (stored on Track). Skips Track rows that
 * already have audioFeaturesFetchedAt set. Lost on Node restart —
 * acceptable for non-critical background fill.
 */
export async function enqueueBackgroundEnrich(
  searchId: SearchQueryId,
  seed: { artist: string; title: string | null },
  tracks: TrackMeta[],
  pythonServiceUrl: string,
): Promise<void> {
  console.log(
    `[enrichment-queue] dispatched: searchId=${searchId} seed="${seed.artist} - ${seed.title}" candidates=${tracks.length} pythonUrl=${pythonServiceUrl}`,
  );
  await Promise.all([enrichCandidates(tracks, pythonServiceUrl), enrichSeed(searchId, seed, pythonServiceUrl)]);
}

async function enrichCandidates(tracks: TrackMeta[], pythonServiceUrl: string): Promise<void> {
  if (!tracks.length) return;

  const urls = tracks.map((t) => t.sourceUrl);
  const cached = await prisma.track.findMany({
    where: { sourceUrl: { in: urls }, audioFeaturesFetchedAt: { not: null } },
    select: { sourceUrl: true },
  });
  const cachedUrls = new Set(cached.map((r) => r.sourceUrl));
  const needFetch = tracks.filter((t) => !cachedUrls.has(t.sourceUrl));
  if (!needFetch.length) return;

  let enriched: TrackMeta[];
  try {
    const resp = await enrichAudioFeatures({ tracks: needFetch }, { baseURL: pythonServiceUrl });
    enriched = resp.tracks;
  } catch (err) {
    console.error("[enrichment-queue] candidate /enrich failed:", err);
    return;
  }

  const now = new Date();
  await Promise.all(
    enriched
      .filter((t) => t.bpm != null || t.key != null)
      .map((t) =>
        prisma.track
          .update({
            where: { sourceUrl: t.sourceUrl },
            data: {
              bpm: t.bpm ?? undefined,
              musicalKey: t.key ?? undefined,
              audioFeaturesFetchedAt: now,
            },
          })
          .catch((err) => {
            console.error(`[enrichment-queue] update failed for ${t.sourceUrl}:`, err);
          }),
      ),
  );
}

async function enrichSeed(
  searchId: SearchQueryId,
  seed: { artist: string; title: string | null },
  pythonServiceUrl: string,
): Promise<void> {
  // Artist-only searches have no track-level seed to scrape; skip.
  if (!seed.title) return;

  const existing = await prisma.searchQuery.findUnique({
    where: { id: searchId },
    select: { seedBpm: true, seedMusicalKey: true },
  });
  if (existing?.seedBpm != null && existing?.seedMusicalKey != null) return;

  const seedPseudoTrack: TrackMeta = {
    title: seed.title,
    artist: seed.artist,
    source: "seed",
    sourceUrl: `seed://${searchId}`,
  };

  try {
    const resp = await enrichAudioFeatures({ tracks: [seedPseudoTrack] }, { baseURL: pythonServiceUrl });
    const enriched = resp.tracks[0];
    if (!enriched) return;
    if (enriched.bpm == null && enriched.key == null) return;
    await prisma.searchQuery.update({
      where: { id: searchId },
      data: {
        seedBpm: enriched.bpm ?? undefined,
        seedMusicalKey: enriched.key ?? undefined,
      },
    });
  } catch (err) {
    console.error("[enrichment-queue] seed /enrich failed:", err);
  }
}
