import type { AudioFeatures } from "@/lib/aggregator";
import { prisma } from "@/lib/prisma";
import { enrichAudioFeatures } from "@/lib/python-api/generated/clients/enrichAudioFeatures";
import type { TrackMeta } from "@/lib/python-api/generated/types/TrackMeta";

type Seed = { artist: string; title: string | null };
type Candidate = { sourceUrl: string; artist: string; title: string; source: string };

// Pseudo sourceUrl used to round-trip the seed through /enrich. Never persisted
// under this URL — the resolved seed bpm/key lands on SearchQuery instead.
const SEED_PSEUDO_URL = "seed://__eager__";

// Hard ceiling on the synchronous Beatport scrape. On timeout we soft-degrade to
// the cached audio features so a slow source can't hang the search response.
const ENRICH_TIMEOUT_MS = 75_000;

// Cooldown before re-attempting a track Beatport had no data for. Found bpm/key
// is immutable and never re-scraped; a "not found" result, though, may become
// available later (Beatport adds catalogue over time), so it's retried after
// this window instead of being cached as a permanent negative. Transient
// failures (429/timeout/network) aren't stamped at all and retry immediately.
const NOT_FOUND_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export type ResolvedAudioFeatures = {
  audio: AudioFeatures;
  // sourceUrls scraped this search (regardless of whether Beatport had a hit) so
  // the caller can stamp `audioFeaturesFetchedAt` and not re-scrape next time.
  attemptedUrls: Set<string>;
};

/**
 * Eager BPM/key resolution for a search. Reads the DB cache (prior seed
 * enrichment + per-candidate audio features), then synchronously scrapes
 * Beatport via /enrich for every candidate not yet attempted, returning the
 * merged AudioFeatures so the aggregator can sort on the audio signal in the
 * same request. Soft-degrades to the cached values if /enrich fails.
 */
export async function resolveAudioFeatures(
  cacheKey: string,
  seed: Seed,
  candidates: Candidate[],
  pythonServiceUrl: string,
): Promise<ResolvedAudioFeatures> {
  const urls = candidates.map((c) => c.sourceUrl);
  const [seedRow, rows] = await Promise.all([
    prisma.searchQuery.findFirst({
      where: { cacheKey, seedBpm: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { seedBpm: true, seedMusicalKey: true, seedGenre: true },
    }),
    urls.length
      ? prisma.track.findMany({
          where: { sourceUrl: { in: urls } },
          select: { sourceUrl: true, bpm: true, musicalKey: true, audioFeaturesFetchedAt: true },
        })
      : Promise.resolve([]),
  ]);

  const candidateBpm = new Map<string, number | null>();
  const candidateMusicalKey = new Map<string, string | null>();
  const recentlyTried = new Set<string>();
  const retryCutoff = new Date(Date.now() - NOT_FOUND_RETRY_MS);
  for (const r of rows) {
    candidateBpm.set(r.sourceUrl, r.bpm);
    candidateMusicalKey.set(r.sourceUrl, r.musicalKey);
    // Honour a prior "not found" only within the cooldown window — past it the
    // track is re-attempted. Found values are kept regardless (handled by the
    // gap filter, which skips any row that already has bpm or key).
    if (r.audioFeaturesFetchedAt != null && r.audioFeaturesFetchedAt >= retryCutoff) {
      recentlyTried.add(r.sourceUrl);
    }
  }

  let seedBpm = seedRow?.seedBpm ?? null;
  let seedMusicalKey = seedRow?.seedMusicalKey ?? null;
  const seedGenre = seedRow?.seedGenre ?? null;

  // Gaps: candidates still missing both signals and not scraped within the
  // cooldown. A track that already has bpm/key is never a gap (never re-scraped);
  // a fruitless scrape isn't repeated every search, but isn't permanent either.
  const gaps = candidates.filter(
    (c) =>
      !recentlyTried.has(c.sourceUrl) &&
      candidateBpm.get(c.sourceUrl) == null &&
      candidateMusicalKey.get(c.sourceUrl) == null,
  );
  const needSeed = seed.title != null && seedBpm == null && seedMusicalKey == null;

  // Filled only after a successful /enrich, and only with gaps Beatport actually
  // resolved (found or definitively not-found). Transient failures and a total
  // /enrich failure leave it empty → those rows aren't stamped → retried next time.
  const attemptedUrls = new Set<string>();
  const audio: AudioFeatures = { seedBpm, seedMusicalKey, seedGenre, candidateBpm, candidateMusicalKey };
  if (!gaps.length && !needSeed) return { audio, attemptedUrls };

  const reqTracks: TrackMeta[] = gaps.map((c) => ({
    title: c.title,
    artist: c.artist,
    source: c.source,
    sourceUrl: c.sourceUrl,
  }));
  if (needSeed) {
    reqTracks.push({ title: seed.title!, artist: seed.artist, source: "seed", sourceUrl: SEED_PSEUDO_URL });
  }

  let resp;
  try {
    resp = await enrichAudioFeatures(
      { tracks: reqTracks },
      { baseURL: pythonServiceUrl, signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS) },
    );
  } catch (err) {
    console.error("[enrichment] eager /enrich failed:", err);
    return { audio, attemptedUrls };
  }

  const failed = new Set(resp.failed_urls ?? []);
  for (const t of resp.tracks) {
    if (t.sourceUrl === SEED_PSEUDO_URL) {
      seedBpm = t.bpm ?? null;
      seedMusicalKey = t.key ?? null;
      continue;
    }
    candidateBpm.set(t.sourceUrl, t.bpm ?? null);
    candidateMusicalKey.set(t.sourceUrl, t.key ?? null);
  }
  for (const c of gaps) {
    if (!failed.has(c.sourceUrl)) attemptedUrls.add(c.sourceUrl);
  }

  return { audio: { seedBpm, seedMusicalKey, seedGenre, candidateBpm, candidateMusicalKey }, attemptedUrls };
}
