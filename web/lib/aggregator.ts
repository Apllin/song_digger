import type { SourceList, TrackMeta } from "@/lib/python-client";

export type { SourceList } from "@/lib/python-client";

export interface SearchFilters {
  bpmMin?: number;
  bpmMax?: number;
  key?: string; // Camelot notation e.g. "8A"
  genre?: string;
}

export interface TrackFeedback {
  disliked: Array<{ artist: string }>;
}

// ── RRF constants ────────────────────────────────────────────────────────────
// Cormack 2009 default. RRF score = Σ 1 / (k + rank). Larger k flattens the
// curve (rank-1 vs rank-2 contribute more equally); smaller k makes the head
// sharper.
const RRF_K = 60;

// Post-RRF nudges. RRF scores are tiny (~0.016 per top-rank appearance), so
// these constants are calibrated to that scale, not the old [0,1] weighted-sum
// scale. Tune via eval.
const DISLIKED_ARTIST_PENALTY = 0.012;
const EMBED_BONUS = 0.0008;

export interface FusedCandidate extends TrackMeta {
  rrfScore: number;
  appearances: { source: string; rank: number }[];
}

// ── Title normalisation ──────────────────────────────────────────────────────
// Mirrors python-service _normalize_title: lower-cased, with whitelisted
// recording-equivalence suffixes (Original Mix, Extended, Radio Edit, Remaster,
// Feat/Ft, Prod, Clean/Explicit, Bonus Track) stripped. Anything not in the
// whitelist (Remix, Dub, Live, VIP, Instrumental, …) survives — those identify
// distinct recordings.
const TITLE_STRIP_PATTERNS: RegExp[] = [
  /\s*[\(\[]original mix[\)\]]/gi,
  /\s*[\(\[]extended(?:\s+mix)?[\)\]]/gi,
  /\s*[\(\[]radio\s+(?:edit|mix)[\)\]]/gi,
  /\s*[\(\[](?:remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)[\)\]]/gi,
  /\s*[\(\[](?:feat\.|ft\.|featuring)\s+[^\)\]]*[\)\]]/gi,
  /\s*[\(\[](?:prod\.|produced\s+by)\s+[^\)\]]*[\)\]]/gi,
  /\s*[\(\[](?:clean|explicit)[\)\]]/gi,
  /\s*[\(\[]bonus\s+track[\)\]]/gi,
];

export function normalizeTitle(s: string): string {
  let out = s.toLowerCase().trim();
  for (const pat of TITLE_STRIP_PATTERNS) out = out.replace(pat, "");
  return out.trim();
}

export function normalizeArtist(artist: string): string {
  return artist.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function identityKey(t: TrackMeta): string {
  return `${normalizeArtist(t.artist)}||${normalizeTitle(t.title)}`;
}

// ── Metadata merge across sources ────────────────────────────────────────────
// When the same identity appears in multiple sources, prefer the first non-null
// value already on the candidate; fill remaining nulls from the new track.
function mergeMetadata(dest: FusedCandidate, src: TrackMeta): void {
  if (dest.bpm == null && src.bpm != null) dest.bpm = src.bpm;
  if (dest.key == null && src.key != null) dest.key = src.key;
  if (dest.energy == null && src.energy != null) dest.energy = src.energy;
  if (dest.coverUrl == null && src.coverUrl != null) dest.coverUrl = src.coverUrl;
  if (dest.embedUrl == null && src.embedUrl != null) dest.embedUrl = src.embedUrl;
  if (dest.label == null && src.label != null) dest.label = src.label;
  if (dest.genre == null && src.genre != null) dest.genre = src.genre;
}

// ── Reciprocal Rank Fusion ───────────────────────────────────────────────────
// Each source produces its own ranked list. A candidate's fused score is
// Σ 1/(k + rankᵢ) over the sources it appears in. Candidates appearing in
// multiple sources naturally outrank single-source candidates, even when no
// single source ranks them at the top.
export function rrfFuse(sourceLists: SourceList[], k: number = RRF_K): FusedCandidate[] {
  const byIdentity = new Map<string, FusedCandidate>();

  for (const list of sourceLists) {
    list.tracks.forEach((track, index) => {
      const rank = index + 1; // 1-indexed for the formula
      const id = identityKey(track);
      const contribution = 1 / (k + rank);

      const existing = byIdentity.get(id);
      if (existing) {
        existing.rrfScore += contribution;
        existing.appearances.push({ source: list.source, rank });
        mergeMetadata(existing, track);
      } else {
        byIdentity.set(id, {
          ...track,
          rrfScore: contribution,
          appearances: [{ source: list.source, rank }],
        });
      }
    });
  }

  return [...byIdentity.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

// ── Artist diversity post-processing ─────────────────────────────────────────
// Prevents any single artist from appearing more than `maxConsecutive` times
// in a row. Without this, three top RRF-ranked tracks by the same artist would
// all cluster at the head of the list.
function diversifyArtists(
  tracks: FusedCandidate[],
  maxConsecutive = 2,
): FusedCandidate[] {
  if (tracks.length <= maxConsecutive) return tracks;

  const result: FusedCandidate[] = [];
  const pool = [...tracks];
  const recentArtists: string[] = [];

  while (pool.length > 0) {
    const window = recentArtists.slice(-maxConsecutive);
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

// ── Main aggregation ─────────────────────────────────────────────────────────
export function aggregateTracks(
  sourceLists: SourceList[],
  filters: SearchFilters,
  feedback?: TrackFeedback,
): TrackMeta[] {
  // 1. Fuse per-source ranks into a single ranked list.
  const fused = rrfFuse(sourceLists);

  // 2. Hard BPM range filter — drop tracks outside the user's range. Tracks
  //    with no BPM are kept (metadata gap should not silently exclude).
  const filtered = fused.filter((t) => {
    if (
      filters.bpmMin !== undefined &&
      filters.bpmMax !== undefined &&
      t.bpm != null
    ) {
      if (t.bpm < filters.bpmMin || t.bpm > filters.bpmMax) return false;
    }
    return true;
  });

  // 3. Post-RRF nudges: dislike penalty, embed bonus.
  const dislikedArtists = feedback?.disliked.length
    ? new Set(feedback.disliked.map((t) => normalizeArtist(t.artist)))
    : undefined;

  for (const t of filtered) {
    if (dislikedArtists?.has(normalizeArtist(t.artist))) {
      t.rrfScore -= DISLIKED_ARTIST_PENALTY;
    }
    if (t.embedUrl) {
      t.rrfScore += EMBED_BONUS;
    }
  }

  // 4. Re-sort after nudges. Surface the rrfScore on `score` so existing
  //    consumers (DB persistence, UI) keep working.
  filtered.sort((a, b) => b.rrfScore - a.rrfScore);
  for (const t of filtered) {
    t.score = t.rrfScore;
  }

  // 5. Artist diversification — stops 3+ consecutive same-artist tracks.
  return diversifyArtists(filtered);
}
