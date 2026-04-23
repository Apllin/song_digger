import type { TrackMeta } from "@/lib/python-client";

export interface SearchFilters {
  bpmMin?: number;
  bpmMax?: number;
  key?: string; // Camelot notation e.g. "8A"
  genre?: string;
}

export interface TrackFeedback {
  liked: Array<{ bpm?: number | null; key?: string | null; energy?: number | null; artist: string }>;
  disliked: Array<{ artist: string }>;
}

// Per-liked-track blending weight toward the liked centroid (caps at MAX).
// E.g. 3 liked tracks → 0.36 weight on centroid, source gets 0.64.
const LIKED_WEIGHT_PER_TRACK = 0.12;
const LIKED_WEIGHT_MAX = 0.65;

// Score penalty applied to any track whose artist was disliked.
const DISLIKED_ARTIST_PENALTY = 0.12;

function computeEffectiveSource(
  sourceBpm: number | null | undefined,
  sourceKey: string | null | undefined,
  sourceEnergy: number | null | undefined,
  feedback: TrackFeedback,
): { bpm: number | null; key: string | null; energy: number | null } {
  const { liked } = feedback;
  if (!liked.length) {
    return { bpm: sourceBpm ?? null, key: sourceKey ?? null, energy: sourceEnergy ?? null };
  }

  const bpms = liked.filter((t) => t.bpm != null).map((t) => t.bpm!);
  const energies = liked.filter((t) => t.energy != null).map((t) => t.energy!);
  const keys = liked.filter((t) => t.key != null).map((t) => t.key!);

  const likedBpm = bpms.length ? bpms.reduce((a, b) => a + b, 0) / bpms.length : null;
  const likedEnergy = energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : null;

  const keyCounts = new Map<string, number>();
  for (const k of keys) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  const likedKey = keys.length
    ? [...keyCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const weight = Math.min(LIKED_WEIGHT_MAX, liked.length * LIKED_WEIGHT_PER_TRACK);

  return {
    bpm:
      likedBpm != null && sourceBpm != null
        ? sourceBpm * (1 - weight) + likedBpm * weight
        : likedBpm ?? sourceBpm ?? null,
    // Switch to liked majority key only once liked tracks dominate (weight ≥ 0.5)
    key: likedKey != null && weight >= 0.5 ? likedKey : (sourceKey ?? null),
    energy:
      likedEnergy != null && sourceEnergy != null
        ? sourceEnergy * (1 - weight) + likedEnergy * weight
        : likedEnergy ?? sourceEnergy ?? null,
  };
}

// ── Scoring weights — all signals normalized to [0, 1] ───────────────────────
// Tune these constants to adjust the relative importance of each signal.
// They do NOT need to sum to 1 — final score is a weighted sum, not a
// probability distribution.
const WEIGHTS = {
  audioSimilarity: 0.40, // cosine embedding similarity — primary signal, must dominate
  bpm:             0.25, // BPM proximity — critical for DJ mixing
  key:             0.13, // harmonic compatibility on the Camelot wheel
  energy:          0.07, // energy level match
  sourceRank:      0.13, // position in source result list (earlier = more relevant)
  embed:           0.02, // tiebreaker — has a playable inline embed
} as const;

// Must match limit_per_source passed to the Python service in the search route.
const SOURCE_RANK_LIMIT = 40;

// ── BPM scoring ───────────────────────────────────────────────────────────────
// Gaussian decay around refBpm. Supports tempo doubling/halving so that
// 70 BPM ↔ 140 BPM counts as a close match — DJs frequently pitch-shift
// between harmonic subdivisions of the same groove.
export function calculateBpmScore(
  trackBpm: number,
  refBpm: number,
  sigma = 12,
): number {
  const delta = Math.min(
    Math.abs(trackBpm - refBpm),
    Math.abs(trackBpm - refBpm * 2),
    Math.abs(trackBpm - refBpm / 2),
  );
  return Math.exp(-(delta * delta) / (2 * sigma * sigma));
}

// ── Key scoring on the Camelot wheel ─────────────────────────────────────────
// Distance = circular step distance (0–6) + ring mismatch (0 or 1), max = 7.
// Score decays linearly from 1.0 (exact) to 0.0 at distance ≥ 7.
// This replaces the old binary +0.12 / +0.06 / 0 with a smooth gradient.
export function camelotDistance(a: string, b: string): number {
  const aNum = parseInt(a, 10);
  const bNum = parseInt(b, 10);
  if (isNaN(aNum) || isNaN(bNum)) return 7; // treat unknown keys as maximally distant
  const step = Math.abs(aNum - bNum);
  const circDist = Math.min(step, 12 - step);
  const ringDiff = a.at(-1) === b.at(-1) ? 0 : 1;
  return circDist + ringDiff;
}

export function calculateKeyDistanceScore(
  trackKey: string,
  refKey: string,
): number {
  return Math.max(0, 1 - camelotDistance(trackKey, refKey) / 7);
}

// ── Energy scoring ────────────────────────────────────────────────────────────
// Gaussian decay with sigma=0.15 around the source energy (0–1 scale).
// ±0.15 energy delta → 0.61 score; ±0.30 → 0.14.
export function calculateEnergyScore(
  trackEnergy: number,
  refEnergy: number,
): number {
  const delta = Math.abs(trackEnergy - refEnergy);
  return Math.exp(-(delta * delta) / (2 * 0.15 * 0.15));
}

// ── Source rank scoring ───────────────────────────────────────────────────────
// Earlier results from a source are more likely to be relevant.
// Linear decay: rank 0 → 1.0, rank (limit-1) → near 0.
export function calculateSourceRankScore(
  rank: number,
  limit: number,
): number {
  return Math.max(0, 1 - rank / limit);
}

// ── Per-track weighted scoring ────────────────────────────────────────────────
function scoreTrack(
  track: TrackMeta,
  sourceRank: number,
  filters: SearchFilters,
  sourceBpm?: number | null,
  sourceKey?: string | null,
  sourceEnergy?: number | null,
  dislikedArtists?: Set<string>,
): number {
  let score = 0;

  // Audio similarity — only Cosine.club provides embedding-based similarity.
  if (track.source === "cosine_club" && track.score != null) {
    score += WEIGHTS.audioSimilarity * Math.max(0, Math.min(1, track.score));
  }

  // BPM proximity with tempo doubling support.
  const refBpm =
    filters.bpmMin !== undefined && filters.bpmMax !== undefined
      ? (filters.bpmMin + filters.bpmMax) / 2
      : (sourceBpm ?? null);
  if (track.bpm && refBpm) {
    const sigma =
      filters.bpmMin !== undefined && filters.bpmMax !== undefined
        ? Math.max(1, (filters.bpmMax - filters.bpmMin) / 4)
        : 12;
    score += WEIGHTS.bpm * calculateBpmScore(track.bpm, refBpm, sigma);
  }

  // Harmonic compatibility — graduated Camelot distance, not binary.
  const refKey = filters.key ?? sourceKey ?? null;
  if (track.key && refKey) {
    score += WEIGHTS.key * calculateKeyDistanceScore(track.key, refKey);
  }

  // Energy proximity — activates only when the Python service provides source energy.
  if (track.energy != null && sourceEnergy != null) {
    score += WEIGHTS.energy * calculateEnergyScore(track.energy, sourceEnergy);
  }

  // Source rank — earlier results in a source's list are more relevant.
  score +=
    WEIGHTS.sourceRank * calculateSourceRankScore(sourceRank, SOURCE_RANK_LIMIT);

  // Embed bonus — prefer tracks the user can actually preview inline.
  if (track.embedUrl) score += WEIGHTS.embed;

  // Penalize artists the user already disliked in this search session.
  if (dislikedArtists?.has(normalizeArtist(track.artist))) {
    score -= DISLIKED_ARTIST_PENALTY;
  }

  return score;
}

// ── URL deduplication ─────────────────────────────────────────────────────────
function deduplicateByUrl(tracks: TrackMeta[]): TrackMeta[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.sourceUrl)) return false;
    seen.add(t.sourceUrl);
    return true;
  });
}

// ── Artist diversity post-processing ─────────────────────────────────────────
// Prevents any single artist from appearing more than `maxConsecutive` times
// in a row. Greedy: tries to satisfy the constraint by pulling forward the
// next highest-scored track from a different artist. Falls back to the next
// available track if all remaining tracks share the recent artist.
function normalizeArtist(artist: string): string {
  return artist.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function diversifyArtists(
  tracks: TrackMeta[],
  maxConsecutive = 2,
): TrackMeta[] {
  if (tracks.length <= maxConsecutive) return tracks;

  const result: TrackMeta[] = [];
  const pool = [...tracks];
  const recentArtists: string[] = [];

  while (pool.length > 0) {
    const window = recentArtists.slice(-maxConsecutive);
    // Find the first track whose artist isn't saturating the recent window.
    const idx = pool.findIndex((t) => {
      const a = normalizeArtist(t.artist);
      return !(
        window.length === maxConsecutive && window.every((w) => w === a)
      );
    });
    const pick = pool.splice(idx >= 0 ? idx : 0, 1)[0];
    result.push(pick);
    recentArtists.push(normalizeArtist(pick.artist));
  }

  return result;
}

// ── Main aggregation ──────────────────────────────────────────────────────────
export function aggregateTracks(
  tracks: TrackMeta[],
  filters: SearchFilters,
  sourceBpm?: number | null,
  sourceKey?: string | null,
  sourceEnergy?: number | null,
  feedback?: TrackFeedback,
): TrackMeta[] {
  // Blend source metadata with liked-track centroid when feedback is present.
  const effective = feedback
    ? computeEffectiveSource(sourceBpm, sourceKey, sourceEnergy, feedback)
    : { bpm: sourceBpm ?? null, key: sourceKey ?? null, energy: sourceEnergy ?? null };

  const dislikedArtists = feedback?.disliked.length
    ? new Set(feedback.disliked.map((t) => normalizeArtist(t.artist)))
    : undefined;

  // 1. Remove exact URL duplicates (same track, same source).
  const urlDeduped = deduplicateByUrl(tracks);

  // 2. Assign per-source rank BEFORE scoring so that earlier results in
  //    each source's list score higher. Rank is 0-indexed per source group.
  const sourceRankMap = new Map<string, number>();
  const ranked = urlDeduped.map((t) => {
    const rank = sourceRankMap.get(t.source) ?? 0;
    sourceRankMap.set(t.source, rank + 1);
    return { track: t, rank };
  });

  // 3. Hard filters — applied after ranking to preserve rank accuracy.
  //    Note: tracks without BPM/key are kept intentionally so metadata gaps
  //    don't silently exclude otherwise relevant results.
  const filtered = ranked.filter(({ track: t }) => {
    if (
      filters.bpmMin !== undefined &&
      filters.bpmMax !== undefined &&
      t.bpm != null
    ) {
      if (t.bpm < filters.bpmMin || t.bpm > filters.bpmMax) return false;
    }
    if (filters.key && t.key != null) {
      // Keep exact match + adjacent/parallel keys (Camelot distance ≤ 1).
      if (camelotDistance(t.key, filters.key) > 1) return false;
    }
    return true;
  });

  // 4. Score each track using all available signals.
  const scored = filtered.map(({ track, rank }) => ({
    ...track,
    score: scoreTrack(
      track,
      rank,
      filters,
      effective.bpm,
      effective.key,
      effective.energy,
      dislikedArtists,
    ),
  }));

  // 5. Sort by score descending.
  const sorted = scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // 6. Gentle diversity pass — avoid artist clusters in the top results.
  return diversifyArtists(sorted);
}
