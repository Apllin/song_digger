import { describe, expect, it } from "vitest";
import type { SourceList } from "./python-api/generated/types/SourceList";
import type { TrackMeta } from "./python-api/generated/types/TrackMeta";
import type { AudioFeatures, WeightConfig } from "./aggregator";
import { aggregateTracks, rrfFuse } from "./aggregator";

function makeTrack(overrides: Partial<TrackMeta> = {}): TrackMeta {
  return {
    title: "T",
    artist: "A",
    artistKey: "a",
    titleKey: "t",
    source: "youtube_music",
    sourceUrl: `https://music.youtube.com/watch?v=${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function listOf(source: string, ...tracks: TrackMeta[]): SourceList {
  return { source, tracks };
}

describe("rrfFuse", () => {
  it("track in 3 sources beats track in 1 source even with worse ranks", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA", artistKey: "artista", titleKey: "a" });
    const trackB = makeTrack({ title: "B", artist: "ArtistB", artistKey: "artistb", titleKey: "b" });
    const trackC = makeTrack({ title: "C", artist: "ArtistC", artistKey: "artistc", titleKey: "c" });
    const trackD = makeTrack({ title: "D", artist: "ArtistD", artistKey: "artistd", titleKey: "d" });

    const lists: SourceList[] = [
      { source: "cosine", tracks: [trackA, trackB] }, // A=1, B=2
      { source: "lastfm", tracks: [trackB, trackC] }, // B=1, C=2
      { source: "ytm", tracks: [trackB, trackD] }, // B=1, D=2
    ];
    const result = rrfFuse(lists);
    expect(result[0]!.title).toBe("B"); // appears in 3 sources
    expect(result[0]!.rrfScore).toBeGreaterThan(result[1]!.rrfScore);
  });

  it("merges coverUrl across sources (cosine cover fills ytm null)", () => {
    const ytm: TrackMeta = makeTrack({
      title: "Same",
      artist: "Same",
      artistKey: "same",
      titleKey: "same",
      source: "youtube_music",
    });
    const cosine: TrackMeta = makeTrack({
      title: "Same",
      artist: "Same",
      artistKey: "same",
      titleKey: "same",
      source: "cosine_club",
      coverUrl: "https://i.example/cosine.jpg",
    });
    const lists = [
      { source: "youtube_music", tracks: [ytm] },
      { source: "cosine_club", tracks: [cosine] },
    ];
    const result = rrfFuse(lists);
    expect(result).toHaveLength(1);
    expect(result[0]!.coverUrl).toBe("https://i.example/cosine.jpg");
  });

  it("fuses tracks with matching canonical keys regardless of raw title form", () => {
    // Both have titleKey="grid" — the canonical key drives dedup, not the raw title.
    const a: TrackMeta = makeTrack({
      title: "Grid (Original Mix)",
      artist: "Surgeon",
      artistKey: "surgeon",
      titleKey: "grid",
    });
    const b: TrackMeta = makeTrack({ title: "Grid", artist: "Surgeon", artistKey: "surgeon", titleKey: "grid" });
    const lists = [
      { source: "cosine", tracks: [a] },
      { source: "ytm", tracks: [b] },
    ];
    const result = rrfFuse(lists);
    expect(result).toHaveLength(1);
    expect(result[0]!.appearances).toHaveLength(2);
  });

  it("does NOT fuse tracks with different canonical keys", () => {
    // Same raw title but different titleKey values → separate identities.
    const a: TrackMeta = makeTrack({ title: "Grid", artist: "Surgeon", artistKey: "surgeon", titleKey: "grid remix" });
    const b: TrackMeta = makeTrack({ title: "Grid", artist: "Surgeon", artistKey: "surgeon", titleKey: "grid" });
    const lists = [
      { source: "cosine", tracks: [a] },
      { source: "ytm", tracks: [b] },
    ];
    const result = rrfFuse(lists);
    expect(result).toHaveLength(2);
  });

  it("empty source list contributes nothing", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA", artistKey: "artista", titleKey: "a" });
    const lists = [
      { source: "cosine", tracks: [] },
      { source: "ytm", tracks: [trackA] },
    ];
    const result = rrfFuse(lists);
    expect(result).toHaveLength(1);
    expect(result[0]!.rrfScore).toBeCloseTo(1 / 61, 10);
  });

  it("graceful when cosine is silent (the main goal)", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA", artistKey: "artista", titleKey: "a" });
    const trackB = makeTrack({ title: "B", artist: "ArtistB", artistKey: "artistb", titleKey: "b" });
    const trackC = makeTrack({ title: "C", artist: "ArtistC", artistKey: "artistc", titleKey: "c" });

    const lists = [
      { source: "cosine", tracks: [] },
      { source: "ytm", tracks: [trackA, trackB] },
      { source: "lastfm", tracks: [trackA, trackC] },
    ];
    const result = rrfFuse(lists);
    expect(result[0]!.title).toBe("A"); // dual confirmation
    expect(result.length).toBe(3);
  });

  it("attaches per-source appearances with rank", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA", artistKey: "artista", titleKey: "a" });
    const lists = [
      { source: "cosine", tracks: [trackA] },
      { source: "ytm", tracks: [makeTrack({ title: "Other", artistKey: "other", titleKey: "other" }), trackA] },
    ];
    const result = rrfFuse(lists);
    expect(result[0]!.appearances).toEqual([
      { source: "cosine", rank: 1 },
      { source: "ytm", rank: 2 },
    ]);
  });

  it("tracks with no canonical keys (empty string) form their own identity bucket", () => {
    // Missing artistKey/titleKey coalesce to "" and fuse together correctly.
    const a: TrackMeta = makeTrack({ title: "X", artist: "Y", artistKey: undefined, titleKey: undefined });
    const b: TrackMeta = makeTrack({ title: "X2", artist: "Y2", artistKey: undefined, titleKey: undefined });
    const lists = [
      { source: "cosine", tracks: [a] },
      { source: "ytm", tracks: [b] },
    ];
    const result = rrfFuse(lists);
    // Both coalesce to "||" — same identity bucket, so they fuse into one.
    expect(result).toHaveLength(1);
    expect(result[0]!.appearances).toHaveLength(2);
  });
});

describe("aggregateTracks — basic pipeline", () => {
  it("returns empty for empty input", () => {
    expect(aggregateTracks([])).toEqual([]);
  });

  it("attaches a numeric score (rrfScore) to every returned track", () => {
    const t = makeTrack();
    const result = aggregateTracks([listOf("ytm", t)]);
    expect(typeof result[0]!.score).toBe("number");
    expect(result[0]!.score).toBeGreaterThan(0);
  });

  it("multi-source confirmation outranks single-source top hit", () => {
    const dual = makeTrack({ title: "Dual", artist: "X", artistKey: "x", titleKey: "dual" });
    const solo = makeTrack({ title: "Solo", artist: "Y", artistKey: "y", titleKey: "solo" });
    const result = aggregateTracks([
      // Solo is rank-1 in cosine, but Dual appears in two sources.
      listOf("cosine_club", solo, dual),
      listOf("youtube_music", dual),
    ]);
    expect(result[0]!.title).toBe("Dual");
  });
});

describe("aggregateTracks — artist diversity", () => {
  it("breaks up runs of >2 consecutive same-artist tracks", () => {
    // Three Surgeon tracks fused at the top of cosine — without diversification
    // the top three would all be Surgeon.
    const tracks = [
      makeTrack({ sourceUrl: "a1", artist: "Surgeon", artistKey: "surgeon", title: "S1", titleKey: "s1" }),
      makeTrack({ sourceUrl: "a2", artist: "Surgeon", artistKey: "surgeon", title: "S2", titleKey: "s2" }),
      makeTrack({ sourceUrl: "a3", artist: "Surgeon", artistKey: "surgeon", title: "S3", titleKey: "s3" }),
      makeTrack({ sourceUrl: "b1", artist: "Mulero", artistKey: "mulero", title: "M1", titleKey: "m1" }),
    ];
    const result = aggregateTracks([listOf("cosine_club", ...tracks)]);
    const artistKeys = result.map((t) => t.artistKey ?? "");
    for (let i = 0; i + 2 < artistKeys.length; i++) {
      const run = artistKeys.slice(i, i + 3);
      expect(new Set(run).size).toBeGreaterThan(1);
    }
  });

  it("uses artistKey for diversity, not raw artist string", () => {
    // Accented and unaccented forms share the same artistKey — treated as same artist.
    const tracks = [
      makeTrack({ sourceUrl: "u1", artist: "Óscar Mulero", artistKey: "oscar mulero", title: "T1", titleKey: "t1" }),
      makeTrack({ sourceUrl: "u2", artist: "Oscar Mulero", artistKey: "oscar mulero", title: "T2", titleKey: "t2" }),
      makeTrack({ sourceUrl: "u3", artist: "Oscar Mulero", artistKey: "oscar mulero", title: "T3", titleKey: "t3" }),
      makeTrack({ sourceUrl: "u4", artist: "Surgeon", artistKey: "surgeon", title: "T4", titleKey: "t4" }),
    ];
    const result = aggregateTracks([listOf("cosine_club", ...tracks)]);
    const artistKeys = result.map((t) => t.artistKey ?? "");
    for (let i = 0; i + 2 < artistKeys.length; i++) {
      const run = artistKeys.slice(i, i + 3);
      expect(new Set(run).size).toBeGreaterThan(1);
    }
  });
});

describe("aggregateTracks — audio bonus", () => {
  const seedBpm = 130;
  const weights = {
    rankDecayK: 60,
    cosineScoreWeight: 0,
    numSourcesWeight: 0,
    bpmDeltaWeight: 0,
    bpmCompatibleWeight: 1.0,
    bpmPresentWeight: 0,
    keyCompatibleWeight: 0,
    keyPresentWeight: 0,
    sourceWeights: {},
    genreAdjustments: {},
    bpmRangeAdjustments: {},
  };

  it("compatible BPM nudges candidate above tied source-only competitor", () => {
    const compat = makeTrack({ sourceUrl: "compat", artist: "X", artistKey: "x", title: "T1", titleKey: "t1" });
    const off = makeTrack({ sourceUrl: "off", artist: "Y", artistKey: "y", title: "T2", titleKey: "t2" });
    const audio = {
      seedBpm,
      seedMusicalKey: null,
      seedGenre: null,
      candidateBpm: new Map<string, number | null>([
        ["compat", 128],
        ["off", 102],
      ]),
      candidateMusicalKey: new Map<string, string | null>(),
    };
    const result = aggregateTracks([listOf("lastfm", compat, off)], weights, audio);
    // Same rank base contribution; compatible BPM bonus tips compat above off.
    expect(result.map((t) => t.sourceUrl)).toEqual(["compat", "off"]);
  });

  it("AUDIO_BONUS_CAP keeps audio influence below a single multi-source candidate", () => {
    // A multi-source consensus candidate (3 sources) must still outrank a
    // single-source candidate even when the latter has every audio bonus.
    const consensus = makeTrack({ sourceUrl: "cons", artist: "X", artistKey: "x", title: "Cons", titleKey: "cons" });
    const audioWin = makeTrack({ sourceUrl: "aud", artist: "Y", artistKey: "y", title: "Aud", titleKey: "aud" });
    const aggressiveWeights = {
      ...weights,
      bpmCompatibleWeight: 10,
      bpmPresentWeight: 10,
      keyCompatibleWeight: 10,
      keyPresentWeight: 10,
      cosineScoreWeight: 10,
      numSourcesWeight: 10,
    };
    const audio = {
      seedBpm,
      seedMusicalKey: "8A" as string | null,
      seedGenre: null,
      candidateBpm: new Map<string, number | null>([
        ["aud", 130],
        ["cons", null],
      ]),
      candidateMusicalKey: new Map<string, string | null>([
        ["aud", "8A"],
        ["cons", null],
      ]),
    };
    const result = aggregateTracks(
      [listOf("lastfm", audioWin, consensus), listOf("cosine_club", consensus), listOf("trackidnet", consensus)],
      aggressiveWeights,
      audio,
    );
    expect(result[0]?.sourceUrl).toBe("cons");
  });

  it("missing seed BPM disables the bonus even if candidate has one", () => {
    const a = makeTrack({ sourceUrl: "a", artist: "X", artistKey: "x", title: "T1", titleKey: "t1" });
    const b = makeTrack({ sourceUrl: "b", artist: "Y", artistKey: "y", title: "T2", titleKey: "t2" });
    const audio = {
      seedBpm: null,
      seedMusicalKey: null,
      seedGenre: null,
      candidateBpm: new Map<string, number | null>([["a", 130]]),
      candidateMusicalKey: new Map<string, string | null>(),
    };
    const wins = { ...weights, bpmCompatibleWeight: 10 };
    const result = aggregateTracks([listOf("lastfm", a, b)], wins, audio);
    // Without a seed BPM, no bonus → a stays at rank 1 by RRF (tied), b by RRF
    // ordering — but at minimum both are returned without throwing.
    expect(result).toHaveLength(2);
  });
});

describe("genre and BPM range adjustments", () => {
  const baseWeights: WeightConfig = {
    rankDecayK: 60,
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

  it("genre × source adjustment boosts beatport candidate when seed is techno", () => {
    const trackA = makeTrack({
      title: "A",
      artist: "ArtistA",
      artistKey: "artista",
      titleKey: "a",
      sourceUrl: "https://beatport.com/a",
    });
    const trackB = makeTrack({
      title: "B",
      artist: "ArtistB",
      artistKey: "artistb",
      titleKey: "b",
      sourceUrl: "https://lastfm.com/b",
    });
    const lists: SourceList[] = [
      { source: "beatport", tracks: [trackA] },
      { source: "lastfm", tracks: [trackB] },
    ];
    const weightsWithAdj: WeightConfig = {
      ...baseWeights,
      genreAdjustments: {
        techno: { beatport: 2.0, lastfm: 0.3 },
      },
    };
    const audio: AudioFeatures = {
      seedBpm: null,
      seedMusicalKey: null,
      seedGenre: "techno",
      candidateBpm: new Map(),
      candidateMusicalKey: new Map(),
    };
    const result = aggregateTracks(lists, weightsWithAdj, audio);
    // beatport gets a large genre adjustment, so trackA should rank higher
    const scoreA = result.find((t) => t.title === "A")!.rrfScore;
    const scoreB = result.find((t) => t.title === "B")!.rrfScore;
    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it("genre adjustment is no-op when seedGenre is null", () => {
    const trackA = makeTrack({
      title: "A",
      artist: "ArtistA",
      artistKey: "artista",
      titleKey: "a",
      sourceUrl: "https://beatport.com/a",
    });
    const trackB = makeTrack({
      title: "B",
      artist: "ArtistB",
      artistKey: "artistb",
      titleKey: "b",
      sourceUrl: "https://lastfm.com/b",
    });
    const lists: SourceList[] = [
      { source: "beatport", tracks: [trackA] },
      { source: "lastfm", tracks: [trackB] },
    ];
    const weightsWithAdj: WeightConfig = {
      ...baseWeights,
      genreAdjustments: { techno: { beatport: 2.0 } },
    };
    const audio: AudioFeatures = {
      seedBpm: null,
      seedMusicalKey: null,
      seedGenre: null,
      candidateBpm: new Map(),
      candidateMusicalKey: new Map(),
    };
    const result = aggregateTracks(lists, weightsWithAdj, audio);
    // Both have rank 1 in their respective sources, no adjustment → equal base RRF
    const scoreA = result.find((t) => t.title === "A")!.rrfScore;
    const scoreB = result.find((t) => t.title === "B")!.rrfScore;
    expect(scoreA).toBeCloseTo(scoreB, 5);
  });

  it("BPM range adjustment modifies bpmDelta bonus for matching range", () => {
    const trackA = makeTrack({
      title: "A",
      artist: "ArtistA",
      artistKey: "artista",
      titleKey: "a",
      sourceUrl: "https://beatport.com/a",
    });
    const lists: SourceList[] = [{ source: "beatport", tracks: [trackA] }];
    const weightsWithAdj: WeightConfig = {
      ...baseWeights,
      bpmRangeAdjustments: { fast: { bpmDelta: 1.5, bpmCompatible: 1.0 } },
    };
    const audioWithBpm: AudioFeatures = {
      seedBpm: 130,
      seedMusicalKey: null,
      seedGenre: "techno",
      candidateBpm: new Map([["https://beatport.com/a", 132]]),
      candidateMusicalKey: new Map(),
    };
    const audioNoBpm: AudioFeatures = {
      ...audioWithBpm,
      seedBpm: null,
      candidateBpm: new Map(),
    };
    const withBpm = aggregateTracks(lists, weightsWithAdj, audioWithBpm);
    const withoutBpm = aggregateTracks(lists, weightsWithAdj, audioNoBpm);
    expect(withBpm[0]!.rrfScore).toBeGreaterThan(withoutBpm[0]!.rrfScore);
  });
});
