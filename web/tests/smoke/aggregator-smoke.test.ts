/**
 * Aggregator smoke tests — pure compute, no network or DB.
 *
 * These verify the post-Stage-F aggregator (RRF + artist
 * diversification) on crafted source lists. The dislike filter lives
 * upstream in app/api/search/route.ts (filtering source lists before
 * `aggregateTracks` runs); the dislike-CRUD smoke covers it end-to-end.
 *
 * Run with:  pnpm test:smoke
 */
import { describe, expect, it } from "vitest";

import { aggregateTracks, normalizeArtist, normalizeTitle, rrfFuse } from "@/lib/aggregator";
import type { SourceList } from "@/lib/python-api/generated/types/SourceList";
import type { TrackMeta } from "@/lib/python-api/generated/types/TrackMeta";

function track(overrides: Partial<TrackMeta> = {}): TrackMeta {
  return {
    title: "T",
    artist: "A",
    source: "youtube_music",
    sourceUrl: `https://music.youtube.com/watch?v=${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

describe("aggregator smoke — multi-source agreement boost", () => {
  it("track in 3 sources outranks track in 1 source even with worse ranks", () => {
    const shared = { title: "Shared", artist: "Shared Artist" };
    const onlyA = { title: "OnlyA", artist: "Lone A" };
    const onlyB = { title: "OnlyB", artist: "Lone B" };

    const lists: SourceList[] = [
      {
        source: "cosine_club",
        tracks: [track({ ...onlyA }), track(shared)],
      },
      {
        source: "lastfm",
        tracks: [track({ ...onlyB }), track(shared)],
      },
      {
        source: "youtube_music",
        tracks: [track({ ...onlyA }), track(shared)],
      },
    ];

    const result = aggregateTracks(lists);
    expect(result[0].title.toLowerCase()).toBe("shared");
    // shared appears in 3 sources, onlyA in 2, onlyB in 1
    const titles = result.map((t) => t.title.toLowerCase());
    expect(titles.indexOf("shared")).toBe(0);
    expect(titles.indexOf("onlya")).toBeGreaterThanOrEqual(1);
  });
});

describe("aggregator smoke — artist diversification", () => {
  it("limits a single artist to 2 consecutive in the top-N", () => {
    // Five tracks by the same artist all top-ranked in one source —
    // diversification should interleave others so we never see 3 in a row.
    const samey = (n: number) => track({ title: `S${n}`, artist: "Same Artist" });
    const filler = (n: number) => track({ title: `F${n}`, artist: `Filler ${n}` });

    const lists: SourceList[] = [
      {
        source: "cosine_club",
        tracks: [samey(1), samey(2), samey(3), samey(4), samey(5)],
      },
      {
        source: "lastfm",
        tracks: [filler(1), filler(2), filler(3), filler(4)],
      },
    ];

    const result = aggregateTracks(lists);
    let consecutive = 0;
    let maxConsecutive = 0;
    let prev = "";
    for (const t of result) {
      const a = normalizeArtist(t.artist);
      if (a === prev) {
        consecutive++;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
      } else {
        consecutive = 1;
        prev = a;
      }
    }
    // diversifyArtists() forbids `maxConsecutive == window.length` matches —
    // i.e. with maxConsecutive=2, three of the same in a row is the failure
    // signal. So we assert ≤ 2 consecutive.
    expect(maxConsecutive).toBeLessThanOrEqual(2);
  });
});

describe("aggregator smoke — empty inputs", () => {
  it("doesn't crash on empty source lists", () => {
    expect(() => aggregateTracks([])).not.toThrow();
    expect(aggregateTracks([])).toEqual([]);
  });

  it("doesn't crash when every source list is empty", () => {
    const lists: SourceList[] = [
      { source: "cosine_club", tracks: [] },
      { source: "lastfm", tracks: [] },
    ];
    expect(aggregateTracks(lists)).toEqual([]);
  });
});

describe("aggregator smoke — identity dedup across sources", () => {
  it("same (artist, normalized title) fuses across sources into one row", () => {
    // Two sources, same identity via different cosmetics
    const a = track({
      title: "Grid (Original Mix)",
      artist: "Surgeon",
      source: "cosine_club",
    });
    const b = track({
      title: "Grid",
      artist: "Surgeon",
      source: "lastfm",
    });
    const result = rrfFuse([
      { source: "cosine_club", tracks: [a] },
      { source: "lastfm", tracks: [b] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].appearances).toHaveLength(2);
    // Sanity-check that normalize* still does what fuse depends on
    expect(normalizeTitle("Grid (Original Mix)")).toBe("grid");
    expect(normalizeArtist("Surgeon")).toBe("surgeon");
  });
});
