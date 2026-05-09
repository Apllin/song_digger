/**
 * Aggregator-only speed test — pure compute, no network or DB.
 *
 * Builds 6 source lists with realistic overlap (RRF only matters when
 * sources agree; 200 entirely-unique tracks would skip the dedup
 * hot path) and runs aggregateTracks 100 times. P95 ≈ runs[94] after
 * sort. Threshold is generous — 200ms catches a regression like
 * "someone made identityKey O(n²)" without firing on noisy CI boxes.
 *
 * Run with:  pnpm test:speed
 */
import { describe, expect, it } from "vitest";

import { aggregateTracks } from "@/lib/aggregator";
import type { SourceList } from "@/lib/python-api/generated/types/SourceList";
import type { TrackMeta } from "@/lib/python-api/generated/types/TrackMeta";

const RUNS = 100;
const P95_INDEX = Math.floor(RUNS * 0.95) - 1; // 94 for 100 runs
const P95_THRESHOLD_MS = 200;

const SOURCES = ["cosine_club", "youtube_music", "bandcamp", "yandex_music", "lastfm", "trackidnet"] as const;

function buildMockSourceLists(targetTotal: number): SourceList[] {
  // ~30% of tracks appear in 3+ sources, ~30% in 2, ~40% unique. Mirrors
  // the kind of distribution we see in real /similar fan-outs and ensures
  // both the dedup branch and the metadata-merge branch are exercised.
  const overlapPool: TrackMeta[] = Array.from({ length: 50 }, (_, i) => ({
    title: `Overlap Track ${i}`,
    artist: `Overlap Artist ${i % 15}`,
    source: SOURCES[i % SOURCES.length]!,
    sourceUrl: `https://example.com/o/${i}`,
    embedUrl: i % 3 === 0 ? `https://example.com/embed/${i}` : undefined,
    bpm: i % 4 === 0 ? 130 + (i % 12) : undefined,
  }));

  const lists: SourceList[] = SOURCES.map((source, sIdx) => {
    const remaining = Math.floor(targetTotal / SOURCES.length);
    // Each source gets a slice of overlapPool (rotated to vary ranks)
    // plus its own unique tracks to fill out to `remaining`.
    const overlap = overlapPool.slice(sIdx * 8, sIdx * 8 + 25).map((t) => ({ ...t, source })); // appearances accrue under the source's own name
    const unique: TrackMeta[] = Array.from({ length: Math.max(0, remaining - overlap.length) }, (_, i) => ({
      title: `Unique ${source} Track ${i}`,
      artist: `Unique Artist ${sIdx}-${i}`,
      source,
      sourceUrl: `https://example.com/${source}/${i}`,
    }));
    return { source, tracks: [...overlap, ...unique] };
  });
  return lists;
}

describe("aggregator speed", () => {
  it(`P95 latency on 200-candidate fan-out is < ${P95_THRESHOLD_MS}ms`, () => {
    const lists = buildMockSourceLists(200);
    const totalTracks = lists.reduce((acc, l) => acc + l.tracks.length, 0);
    expect(totalTracks).toBeGreaterThanOrEqual(180);

    // Warm-up — first run can include JIT compile time on V8.
    aggregateTracks(lists);

    const runs: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      aggregateTracks(lists);
      runs.push(performance.now() - start);
    }
    runs.sort((a, b) => a - b);
    const p50 = runs[Math.floor(RUNS / 2)]!;
    const p95 = runs[P95_INDEX]!;
    console.log(`[aggregator speed] P50=${p50.toFixed(2)}ms  P95=${p95.toFixed(2)}ms  total=${totalTracks} candidates`);
    expect(p95).toBeLessThan(P95_THRESHOLD_MS);
  });
});
