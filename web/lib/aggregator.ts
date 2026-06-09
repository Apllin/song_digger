import { z } from "zod";

import { isCamelotCompatible } from "@/lib/camelot";
import type { SourceList } from "@/lib/python-api/generated/types/SourceList";
import type { TrackMeta } from "@/lib/python-api/generated/types/TrackMeta";

// ── RRF constants ────────────────────────────────────────────────────────────
// Cormack 2009 default. RRF score = Σ 1 / (k + rank). Larger k flattens the
// curve (rank-1 vs rank-2 contribute more equally); smaller k makes the head
// sharper.
const RRF_K = 60;
// Mirrors python-service: features used as training input.
const SOURCE_COUNT = 7;
const BPM_DELTA_CAP_BPM = 24;
const BPM_COMPATIBLE_MAX_BPM = 6;
// Per-feature absolute cap on the bonus a single learned weight can add to a
// candidate's rrfScore. A top-rank single-source contribution is ~1/61 ≈ 0.0164;
// at this cap, the strongest possible audio signal is roughly 30% of one source
// hit — enough to break ties between equally-ranked candidates, never enough
// to override multi-source consensus. Tune up if BPM/key empirically deserve
// more weight; tune down if learned coefficients dominate the head of the list.
const AUDIO_BONUS_CAP = 0.005;

// ── Weight config ─────────────────────────────────────────────────────────────
// Loaded from ModelWeights (latest DB row) at search time; falls back to
// DEFAULT_WEIGHTS when no trained model exists yet.
export type WeightConfig = {
  rankDecayK: number;
  cosineScoreWeight: number;
  numSourcesWeight: number;
  bpmDeltaWeight: number;
  bpmCompatibleWeight: number;
  bpmPresentWeight: number;
  keyCompatibleWeight: number;
  keyPresentWeight: number;
  sourceWeights: Partial<Record<string, number>>;
  genreAdjustments: Partial<Record<string, Partial<Record<string, number>>>>;
  bpmRangeAdjustments: Partial<Record<string, Partial<Record<string, number>>>>;
};

export const DEFAULT_WEIGHTS: WeightConfig = {
  rankDecayK: RRF_K,
  cosineScoreWeight: 0,
  numSourcesWeight: 0,
  bpmDeltaWeight: 0,
  bpmCompatibleWeight: 0,
  bpmPresentWeight: 0,
  keyCompatibleWeight: 0,
  keyPresentWeight: 0,
  sourceWeights: {},
  genreAdjustments: {},
  bpmRangeAdjustments: {},
};

// ── Audio features pulled from DB for bonus application ──────────────────────
export type AudioFeatures = {
  seedBpm: number | null;
  seedMusicalKey: string | null;
  seedGenre: string | null;
  candidateBpm: Map<string, number | null>;
  candidateMusicalKey: Map<string, string | null>;
};

export const EMPTY_AUDIO_FEATURES: AudioFeatures = {
  seedBpm: null,
  seedMusicalKey: null,
  seedGenre: null,
  candidateBpm: new Map(),
  candidateMusicalKey: new Map(),
};

// ── Feature snapshot ──────────────────────────────────────────────────────────
// Written to SearchResult.features at aggregation time; used as ML input.
// Zod schema is the source of truth so the DB JSON can be validated at read time.
export const TrackFeaturesSchema = z.object({
  appearances: z.array(z.object({ source: z.string(), rank: z.number() })),
  numSources: z.number(),
  minSourceRank: z.number(),
  cosineScore: z.number().nullable(),
  rrfScore: z.number(),
});

export type TrackFeatures = z.infer<typeof TrackFeaturesSchema>;

export interface FusedCandidate extends TrackMeta {
  rrfScore: number;
  cosineScore: number | null;
  appearances: { source: string; rank: number }[];
}

// ── Title normalisation ──────────────────────────────────────────────────────
// Mirrors python-service _normalize_title: lower-cased, with whitelisted
// recording-equivalence suffixes (Original Mix, Extended, Radio Edit, Remaster,
// Feat/Ft, Prod, Clean/Explicit, Bonus Track) stripped. Anything not in the
// whitelist (Remix, Dub, Live, VIP, Instrumental, …) survives — those identify
// distinct recordings.
// Two surface forms: bracketed ("Track (Original Mix)") and hyphen-trailed
// ("Track - Original Mix"). Last.fm/Discogs emit the latter; without it,
// the same recording from different sources doesn't fuse in RRF.
const TITLE_STRIP_PATTERNS: RegExp[] = [
  /\s*[([]original mix[)\]]/gi,
  /\s*[([]extended(?:\s+mix)?[)\]]/gi,
  /\s*[([]radio\s+(?:edit|mix)[)\]]/gi,
  /\s*[([](?:remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)[)\]]/gi,
  /\s*[([](?:feat\.|ft\.|featuring)\s+[^)\]]*[)\]]/gi,
  /\s*[([](?:prod\.|produced\s+by)\s+[^)\]]*[)\]]/gi,
  /\s*[([](?:clean|explicit)[)\]]/gi,
  /\s*[([]bonus\s+track[)\]]/gi,
  /\s+[-–—]\s+original mix\s*$/gi,
  /\s+[-–—]\s+extended(?:\s+mix)?\s*$/gi,
  /\s+[-–—]\s+radio\s+(?:edit|mix)\s*$/gi,
  /\s+[-–—]\s+(?:remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)\s*$/gi,
  /\s+(?:feat\.|ft\.|featuring)\s+.*$/gi,
];

export function normalizeTitle(s: string): string {
  let out = s.toLowerCase().trim();
  for (const pat of TITLE_STRIP_PATTERNS) out = out.replace(pat, "");
  return out.replace(/\s+/g, " ").trim();
}

export function normalizeArtist(artist: string): string {
  // NFKD-decompose so accented forms split into base + combining marks,
  // then strip the combining marks before the alphanumeric filter — otherwise
  // "Óscar Mulero" → "scarmulero" (Ó dropped) doesn't fuse with
  // "Oscar Mulero" → "oscarmulero" across sources. Mirror in
  // python-service _normalize / _same_artist.
  return artist
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function identityKey(t: TrackMeta): string {
  return `${normalizeArtist(t.artist)}||${normalizeTitle(t.title)}`;
}

// ── Metadata merge across sources ────────────────────────────────────────────
// When the same identity appears in multiple sources, fill any null
// coverUrl/embedUrl on the existing candidate from the new track.
function mergeMetadata(dest: FusedCandidate, src: TrackMeta): void {
  if (dest.coverUrl == null && src.coverUrl != null) dest.coverUrl = src.coverUrl;
  if (dest.embedUrl == null && src.embedUrl != null) dest.embedUrl = src.embedUrl;
}

// ── Reciprocal Rank Fusion ───────────────────────────────────────────────────
// Each source produces its own ranked list. A candidate's fused score is
// Σ sourceWeight / (k + rankᵢ) over the sources it appears in. Candidates
// appearing in multiple sources naturally outrank single-source candidates.
// sourceWeights default to 1.0; k defaults to RRF_K (60).
export function rrfFuse(sourceLists: SourceList[], weights: WeightConfig = DEFAULT_WEIGHTS): FusedCandidate[] {
  const byIdentity = new Map<string, FusedCandidate>();

  for (const list of sourceLists) {
    const sw = weights.sourceWeights[list.source] ?? 1.0;
    list.tracks.forEach((track, index) => {
      const rank = index + 1; // 1-indexed for the formula
      const id = identityKey(track);
      const contribution = sw / (weights.rankDecayK + rank);

      const existing = byIdentity.get(id);
      if (existing) {
        existing.rrfScore += contribution;
        existing.appearances.push({ source: list.source, rank });
        mergeMetadata(existing, track);
        if (list.source === "cosine_club" && existing.cosineScore == null) {
          existing.cosineScore = track.score ?? null;
        }
      } else {
        byIdentity.set(id, {
          ...track,
          rrfScore: contribution,
          cosineScore: list.source === "cosine_club" ? (track.score ?? null) : null,
          appearances: [{ source: list.source, rank }],
        });
      }
    });
  }

  return [...byIdentity.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

export function buildFeatures(t: FusedCandidate): TrackFeatures {
  return {
    appearances: t.appearances,
    numSources: t.appearances.length,
    minSourceRank: Math.min(...t.appearances.map((a) => a.rank)),
    cosineScore: t.cosineScore,
    rrfScore: t.rrfScore,
  };
}

// ── Artist diversity post-processing ─────────────────────────────────────────
// Prevents any single artist from appearing more than `maxConsecutive` times
// in a row. Without this, three top RRF-ranked tracks by the same artist would
// all cluster at the head of the list.
function diversifyArtists(tracks: FusedCandidate[], maxConsecutive = 2): FusedCandidate[] {
  if (tracks.length <= maxConsecutive) return tracks;

  const result: FusedCandidate[] = [];
  const pool = [...tracks];
  const recentArtists: string[] = [];

  while (pool.length > 0) {
    const window = recentArtists.slice(-maxConsecutive);
    const idx = pool.findIndex((t) => {
      const a = normalizeArtist(t.artist);
      return !(window.length === maxConsecutive && window.every((w) => w === a));
    });
    const pick = pool.splice(idx >= 0 ? idx : 0, 1)[0]!;
    result.push(pick);
    recentArtists.push(normalizeArtist(pick.artist));
  }

  return result;
}

// ── Audio bonus decoration ────────────────────────────────────────────────────
// Adds per-candidate bonuses for cosineScore, numSources, and BPM/key signals.
// Each contribution is clipped to ±AUDIO_BONUS_CAP so the learned coefficients
// nudge ordering without overriding what the per-source RRF already says.
function clipBonus(weight: number, value: number): number {
  const raw = weight * value;
  if (raw > AUDIO_BONUS_CAP) return AUDIO_BONUS_CAP;
  if (raw < -AUDIO_BONUS_CAP) return -AUDIO_BONUS_CAP;
  return raw;
}

function getBpmRange(bpm: number): string {
  if (bpm < 90) return "slow";
  if (bpm < 120) return "mid";
  if (bpm < 140) return "fast";
  return "vfast";
}

function decorateWithGenreAndBpmAdjustments(
  candidates: FusedCandidate[],
  weights: WeightConfig,
  audio: AudioFeatures,
): void {
  const genreAdj =
    audio.seedGenre && weights.genreAdjustments ? (weights.genreAdjustments[audio.seedGenre] ?? {}) : {};
  const bpmRange = audio.seedBpm != null ? getBpmRange(audio.seedBpm) : null;
  const bpmRangeAdj = bpmRange && weights.bpmRangeAdjustments ? (weights.bpmRangeAdjustments[bpmRange] ?? {}) : {};

  for (const c of candidates) {
    // Genre × source rank adjustments
    for (const { source, rank } of c.appearances) {
      const adj = genreAdj[source] ?? 0;
      if (adj !== 0) {
        c.rrfScore += clipBonus(adj, 1.0 / (weights.rankDecayK + rank));
      }
    }

    // Genre × cosine score adjustment
    if (c.cosineScore != null) {
      const cosAdj = genreAdj["cosine_score"] ?? 0;
      if (cosAdj !== 0) c.rrfScore += clipBonus(cosAdj, c.cosineScore);
    }

    // BPM range × bpmDelta/bpmCompatible adjustments
    if (bpmRange && audio.seedBpm != null) {
      const candBpm = audio.candidateBpm.get(c.sourceUrl) ?? null;
      if (candBpm != null) {
        const bpmDelta = Math.abs(audio.seedBpm - candBpm);
        const bpmDeltaNorm = Math.min(bpmDelta / BPM_DELTA_CAP_BPM, 1);
        const bpmCompatible = bpmDelta <= BPM_COMPATIBLE_MAX_BPM ? 1 : 0;
        const deltaAdj = bpmRangeAdj["bpmDelta"] ?? 0;
        const compatAdj = bpmRangeAdj["bpmCompatible"] ?? 0;
        if (deltaAdj !== 0) c.rrfScore += clipBonus(deltaAdj, bpmDeltaNorm);
        if (compatAdj !== 0) c.rrfScore += clipBonus(compatAdj, bpmCompatible);
      }
    }
  }
}

function decorateWithAudioBonus(candidates: FusedCandidate[], weights: WeightConfig, audio: AudioFeatures): void {
  for (const c of candidates) {
    // Aggregate signals (always known after rrfFuse).
    c.rrfScore += clipBonus(weights.numSourcesWeight, c.appearances.length / SOURCE_COUNT);
    if (c.cosineScore != null) {
      c.rrfScore += clipBonus(weights.cosineScoreWeight, c.cosineScore);
    }

    // BPM bonus requires both seed and candidate to have a value.
    const candBpm = audio.candidateBpm.get(c.sourceUrl) ?? null;
    if (audio.seedBpm != null && candBpm != null) {
      const bpmDelta = Math.abs(audio.seedBpm - candBpm);
      const bpmDeltaNorm = Math.min(bpmDelta / BPM_DELTA_CAP_BPM, 1);
      const bpmCompatible = bpmDelta <= BPM_COMPATIBLE_MAX_BPM ? 1 : 0;
      c.rrfScore += clipBonus(weights.bpmDeltaWeight, bpmDeltaNorm);
      c.rrfScore += clipBonus(weights.bpmCompatibleWeight, bpmCompatible);
      c.rrfScore += clipBonus(weights.bpmPresentWeight, 1);
    }

    // Camelot key bonus likewise requires both sides.
    const candKey = audio.candidateMusicalKey.get(c.sourceUrl) ?? null;
    if (audio.seedMusicalKey != null && candKey != null) {
      const keyCompat = isCamelotCompatible(audio.seedMusicalKey, candKey) ? 1 : 0;
      c.rrfScore += clipBonus(weights.keyCompatibleWeight, keyCompat);
      c.rrfScore += clipBonus(weights.keyPresentWeight, 1);
    }
  }
}

// ── Main aggregation ─────────────────────────────────────────────────────────
export function aggregateTracks(
  sourceLists: SourceList[],
  weights: WeightConfig = DEFAULT_WEIGHTS,
  audio: AudioFeatures = EMPTY_AUDIO_FEATURES,
): FusedCandidate[] {
  // 1. Fuse per-source ranks into a single ranked list.
  const fused = rrfFuse(sourceLists, weights);

  // 2. Apply learned bonuses for aggregate (cosineScore, numSources) and audio
  //    (BPM/key) features. With DEFAULT_WEIGHTS all weights are 0 → no-op.
  decorateWithAudioBonus(fused, weights, audio);
  decorateWithGenreAndBpmAdjustments(fused, weights, audio);

  // 3. Re-sort after bonus application — fused was sorted only by RRF.
  fused.sort((a, b) => b.rrfScore - a.rrfScore);

  // 4. Surface rrfScore on `score` so existing consumers (DB persistence, UI)
  //    keep working.
  for (const t of fused) {
    t.score = t.rrfScore;
  }

  // 5. Artist diversification — stops 3+ consecutive same-artist tracks.
  return diversifyArtists(fused);
}
