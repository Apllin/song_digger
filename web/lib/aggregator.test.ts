import { describe, it, expect } from "vitest";
import {
  aggregateTracks,
  rrfFuse,
  normalizeTitle,
  normalizeArtist,
  type SearchFilters,
  type TrackFeedback,
} from "./aggregator";
import type { SourceList, TrackMeta } from "./python-client";

function makeTrack(overrides: Partial<TrackMeta> = {}): TrackMeta {
  return {
    title: "T",
    artist: "A",
    source: "youtube_music",
    sourceUrl: `https://music.youtube.com/watch?v=${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function listOf(source: string, ...tracks: TrackMeta[]): SourceList {
  return { source, tracks };
}

describe("normalizeTitle", () => {
  it("strips (Original Mix)", () => {
    expect(normalizeTitle("Grid (Original Mix)")).toBe("grid");
    expect(normalizeTitle("Grid [Original Mix]")).toBe("grid");
  });

  it("strips Extended/Radio/Remaster forms", () => {
    expect(normalizeTitle("Track (Extended Mix)")).toBe("track");
    expect(normalizeTitle("Track (Radio Edit)")).toBe("track");
    expect(normalizeTitle("Track (Remastered)")).toBe("track");
    expect(normalizeTitle("Track (Remastered 2019)")).toBe("track");
  });

  it("preserves Remix / Dub / Live (distinct recordings)", () => {
    expect(normalizeTitle("Track (Remix)")).toBe("track (remix)");
    expect(normalizeTitle("Track (Dub)")).toBe("track (dub)");
    expect(normalizeTitle("Track (Live)")).toBe("track (live)");
  });

  it("strips feat/ft/featuring", () => {
    expect(normalizeTitle("Track (feat. Someone)")).toBe("track");
    expect(normalizeTitle("Track (ft. Someone)")).toBe("track");
  });
});

describe("rrfFuse", () => {
  it("track in 3 sources beats track in 1 source even with worse ranks", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA" });
    const trackB = makeTrack({ title: "B", artist: "ArtistB" });
    const trackC = makeTrack({ title: "C", artist: "ArtistC" });
    const trackD = makeTrack({ title: "D", artist: "ArtistD" });

    const lists: SourceList[] = [
      { source: "cosine", tracks: [trackA, trackB] },     // A=1, B=2
      { source: "lastfm", tracks: [trackB, trackC] },     // B=1, C=2
      { source: "ytm",    tracks: [trackB, trackD] },     // B=1, D=2
    ];
    const result = rrfFuse(lists);
    expect(result[0].title).toBe("B"); // appears in 3 sources
    expect(result[0].rrfScore).toBeGreaterThan(result[1].rrfScore);
  });

  it("merges metadata across sources (cosine bpm fills ytm null)", () => {
    const ytm: TrackMeta = makeTrack({ title: "Same", artist: "Same", source: "youtube_music" });
    const cosine: TrackMeta = makeTrack({ title: "Same", artist: "Same", source: "cosine_club", bpm: 138 });
    const lists = [
      { source: "youtube_music", tracks: [ytm] },
      { source: "cosine_club", tracks: [cosine] },
    ];
    const result = rrfFuse(lists);
    expect(result).toHaveLength(1);
    expect(result[0].bpm).toBe(138);
  });

  it("identical track via slightly different titles still fuses (Original Mix)", () => {
    const a: TrackMeta = makeTrack({ title: "Grid (Original Mix)", artist: "Surgeon" });
    const b: TrackMeta = makeTrack({ title: "Grid", artist: "Surgeon" });
    const lists = [
      { source: "cosine", tracks: [a] },
      { source: "ytm", tracks: [b] },
    ];
    const result = rrfFuse(lists);
    expect(result).toHaveLength(1);
    expect(result[0].appearances).toHaveLength(2);
  });

  it("empty source list contributes nothing", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA" });
    const lists = [
      { source: "cosine", tracks: [] },
      { source: "ytm", tracks: [trackA] },
    ];
    const result = rrfFuse(lists);
    expect(result).toHaveLength(1);
    expect(result[0].rrfScore).toBeCloseTo(1 / 61, 10);
  });

  it("graceful when cosine is silent (the main goal)", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA" });
    const trackB = makeTrack({ title: "B", artist: "ArtistB" });
    const trackC = makeTrack({ title: "C", artist: "ArtistC" });

    const lists = [
      { source: "cosine", tracks: [] },
      { source: "ytm",    tracks: [trackA, trackB] },
      { source: "lastfm", tracks: [trackA, trackC] },
    ];
    const result = rrfFuse(lists);
    expect(result[0].title).toBe("A"); // dual confirmation
    expect(result.length).toBe(3);
  });

  it("attaches per-source appearances with rank", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA" });
    const lists = [
      { source: "cosine", tracks: [trackA] },
      { source: "ytm",    tracks: [makeTrack({ title: "Other" }), trackA] },
    ];
    const result = rrfFuse(lists);
    expect(result[0].appearances).toEqual([
      { source: "cosine", rank: 1 },
      { source: "ytm", rank: 2 },
    ]);
  });
});

describe("normalizeArtist", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeArtist("DJ-Stingray!")).toBe("djstingray");
    expect(normalizeArtist("Oscar Mulero")).toBe("oscarmulero");
  });

  it("strips diacritics so accented forms fuse with unaccented across sources", () => {
    // Real-world: Óscar Mulero (Cosine) vs Oscar Mulero (YTM) should merge in RRF.
    expect(normalizeArtist("Óscar Mulero")).toBe("oscarmulero");
    expect(normalizeArtist("Étienne de Crécy")).toBe("etiennedecrecy");
    expect(normalizeArtist("Björk")).toBe("bjork");
    expect(normalizeArtist("Sebastián Ingrosso")).toBe("sebastianingrosso");
  });
});

describe("aggregateTracks — basic pipeline", () => {
  const noFilters: SearchFilters = {};

  it("returns empty for empty input", () => {
    expect(aggregateTracks([], noFilters)).toEqual([]);
  });

  it("attaches a numeric score (rrfScore) to every returned track", () => {
    const t = makeTrack();
    const result = aggregateTracks([listOf("ytm", t)], noFilters);
    expect(typeof result[0].score).toBe("number");
    expect(result[0].score).toBeGreaterThan(0);
  });

  it("multi-source confirmation outranks single-source top hit", () => {
    const dual = makeTrack({ title: "Dual", artist: "X" });
    const solo = makeTrack({ title: "Solo", artist: "Y" });
    const result = aggregateTracks(
      [
        // Solo is rank-1 in cosine, but Dual appears in two sources.
        listOf("cosine_club", solo, dual),
        listOf("youtube_music", dual),
      ],
      noFilters,
    );
    expect(result[0].title).toBe("Dual");
  });
});

describe("aggregateTracks — hard filters", () => {
  it("drops tracks outside bpmMin/bpmMax range", () => {
    const tracks = [
      makeTrack({ sourceUrl: "u1", artist: "A", bpm: 100 }),
      makeTrack({ sourceUrl: "u2", artist: "B", bpm: 130 }),
      makeTrack({ sourceUrl: "u3", artist: "C", bpm: 160 }),
    ];
    const result = aggregateTracks([listOf("ytm", ...tracks)], { bpmMin: 120, bpmMax: 140 });
    expect(result.map((t) => t.bpm)).toEqual([130]);
  });

  it("keeps tracks with missing BPM even when range filter set (metadata gap → keep)", () => {
    const tracks = [
      makeTrack({ sourceUrl: "u1", artist: "A" }), // bpm omitted
      makeTrack({ sourceUrl: "u2", artist: "B", bpm: 100 }),
    ];
    const result = aggregateTracks([listOf("ytm", ...tracks)], { bpmMin: 120, bpmMax: 140 });
    expect(result.map((t) => t.sourceUrl)).toEqual(["u1"]);
  });
});

describe("aggregateTracks — feedback", () => {
  it("disliked-artist penalty pushes those tracks down", () => {
    // Both at rank 1 in their source → tied RRF score. Penalty flips it.
    const a = makeTrack({ sourceUrl: "u1", artist: "Hated" });
    const b = makeTrack({ sourceUrl: "u2", artist: "Loved" });
    const feedback: TrackFeedback = { disliked: [{ artist: "Hated" }] };

    const without = aggregateTracks(
      [listOf("cosine_club", a), listOf("youtube_music", b)],
      {},
    );
    const with_ = aggregateTracks(
      [listOf("cosine_club", a), listOf("youtube_music", b)],
      {}, feedback,
    );

    // Without feedback the order is RRF-tied → first-inserted wins (Hated).
    expect(without[0].artist).toBe("Hated");
    // With feedback the dislike penalty drops Hated below Loved.
    expect(with_[0].artist).toBe("Loved");
  });

  it("normalizes artist names when applying disliked penalty (case + punctuation)", () => {
    const a = makeTrack({ sourceUrl: "u1", artist: "DJ-Stingray!" });
    const b = makeTrack({ sourceUrl: "u2", artist: "Other" });
    const feedback: TrackFeedback = {
      disliked: [{ artist: "dj stingray" }],
    };

    const result = aggregateTracks(
      [listOf("cosine_club", a), listOf("youtube_music", b)],
      {}, feedback,
    );
    expect(result[0].artist).toBe("Other");
  });

  it("undefined feedback behaves identically to no feedback", () => {
    const tracks = [
      makeTrack({ sourceUrl: "u1", artist: "A", bpm: 138 }),
      makeTrack({ sourceUrl: "u2", artist: "B", bpm: 142 }),
    ];
    const lists = [listOf("cosine_club", ...tracks)];
    const a = aggregateTracks(lists, {});
    const b = aggregateTracks(lists, {}, undefined);
    expect(a.map((t) => t.sourceUrl)).toEqual(b.map((t) => t.sourceUrl));
    expect(a.map((t) => t.score)).toEqual(b.map((t) => t.score));
  });
});

describe("aggregateTracks — embed bonus", () => {
  it("breaks ties in favor of tracks with embedUrl", () => {
    const noEmbed = makeTrack({ sourceUrl: "u1", artist: "A" });
    const withEmbed = makeTrack({ sourceUrl: "u2", artist: "B", embedUrl: "https://embed/x" });
    // Both at rank 1 in their respective lists → identical RRF base score.
    const result = aggregateTracks(
      [listOf("cosine_club", noEmbed), listOf("youtube_music", withEmbed)],
      {},
    );
    expect(result[0].sourceUrl).toBe("u2");
  });
});

describe("aggregateTracks — artist diversity", () => {
  it("breaks up runs of >2 consecutive same-artist tracks", () => {
    // Three Surgeon tracks fused at the top of cosine — without diversification
    // the top three would all be Surgeon.
    const tracks = [
      makeTrack({ sourceUrl: "a1", artist: "Surgeon", title: "S1" }),
      makeTrack({ sourceUrl: "a2", artist: "Surgeon", title: "S2" }),
      makeTrack({ sourceUrl: "a3", artist: "Surgeon", title: "S3" }),
      makeTrack({ sourceUrl: "b1", artist: "Mulero",  title: "M1" }),
    ];
    const result = aggregateTracks([listOf("cosine_club", ...tracks)], {});
    const artists = result.map((t) => t.artist);
    for (let i = 0; i + 2 < artists.length; i++) {
      const run = artists.slice(i, i + 3);
      expect(new Set(run).size).toBeGreaterThan(1);
    }
  });
});
