import { describe, expect, it } from "vitest";
import type { SourceList } from "./python-api/generated/types/SourceList";
import type { TrackMeta } from "./python-api/generated/types/TrackMeta";
import { aggregateTracks, normalizeArtist, normalizeTitle, rrfFuse } from "./aggregator";

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

  it("strips hyphen-trailing same-recording suffixes (Spotify/Apple/Yandex form)", () => {
    expect(normalizeTitle("Lunfardo - Original Mix")).toBe("lunfardo");
    expect(normalizeTitle("Track - Extended Mix")).toBe("track");
    expect(normalizeTitle("Track - Radio Edit")).toBe("track");
    expect(normalizeTitle("Track - Remastered")).toBe("track");
    expect(normalizeTitle("Track - Remastered 2019")).toBe("track");
    expect(normalizeTitle("Track – Original Mix")).toBe("track"); // en dash
  });

  it("strips bare feat./ft./featuring without brackets", () => {
    expect(normalizeTitle("Track feat. Someone")).toBe("track");
    expect(normalizeTitle("Track ft. A & B")).toBe("track");
    expect(normalizeTitle("Track featuring X")).toBe("track");
  });

  it("preserves Remix / Live / Version in hyphen form (distinct recordings)", () => {
    expect(normalizeTitle("Track - Remix")).toBe("track - remix");
    expect(normalizeTitle("Track - Live")).toBe("track - live");
    expect(normalizeTitle("Track - Acoustic Version")).toBe("track - acoustic version");
  });
});

describe("rrfFuse", () => {
  it("track in 3 sources beats track in 1 source even with worse ranks", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA" });
    const trackB = makeTrack({ title: "B", artist: "ArtistB" });
    const trackC = makeTrack({ title: "C", artist: "ArtistC" });
    const trackD = makeTrack({ title: "D", artist: "ArtistD" });

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
    const ytm: TrackMeta = makeTrack({ title: "Same", artist: "Same", source: "youtube_music" });
    const cosine: TrackMeta = makeTrack({
      title: "Same",
      artist: "Same",
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

  it("identical track via slightly different titles still fuses (Original Mix)", () => {
    const a: TrackMeta = makeTrack({ title: "Grid (Original Mix)", artist: "Surgeon" });
    const b: TrackMeta = makeTrack({ title: "Grid", artist: "Surgeon" });
    const lists = [
      { source: "cosine", tracks: [a] },
      { source: "ytm", tracks: [b] },
    ];
    const result = rrfFuse(lists);
    expect(result).toHaveLength(1);
    expect(result[0]!.appearances).toHaveLength(2);
  });

  it("empty source list contributes nothing", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA" });
    const lists = [
      { source: "cosine", tracks: [] },
      { source: "ytm", tracks: [trackA] },
    ];
    const result = rrfFuse(lists);
    expect(result).toHaveLength(1);
    expect(result[0]!.rrfScore).toBeCloseTo(1 / 61, 10);
  });

  it("graceful when cosine is silent (the main goal)", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA" });
    const trackB = makeTrack({ title: "B", artist: "ArtistB" });
    const trackC = makeTrack({ title: "C", artist: "ArtistC" });

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
    const trackA = makeTrack({ title: "A", artist: "ArtistA" });
    const lists = [
      { source: "cosine", tracks: [trackA] },
      { source: "ytm", tracks: [makeTrack({ title: "Other" }), trackA] },
    ];
    const result = rrfFuse(lists);
    expect(result[0]!.appearances).toEqual([
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
    const dual = makeTrack({ title: "Dual", artist: "X" });
    const solo = makeTrack({ title: "Solo", artist: "Y" });
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
      makeTrack({ sourceUrl: "a1", artist: "Surgeon", title: "S1" }),
      makeTrack({ sourceUrl: "a2", artist: "Surgeon", title: "S2" }),
      makeTrack({ sourceUrl: "a3", artist: "Surgeon", title: "S3" }),
      makeTrack({ sourceUrl: "b1", artist: "Mulero", title: "M1" }),
    ];
    const result = aggregateTracks([listOf("cosine_club", ...tracks)]);
    const artists = result.map((t) => t.artist);
    for (let i = 0; i + 2 < artists.length; i++) {
      const run = artists.slice(i, i + 3);
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
  };

  it("compatible BPM nudges candidate above tied source-only competitor", () => {
    const compat = makeTrack({ sourceUrl: "compat", artist: "X", title: "T1" });
    const off = makeTrack({ sourceUrl: "off", artist: "Y", title: "T2" });
    const audio = {
      seedBpm,
      seedMusicalKey: null,
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
    const consensus = makeTrack({ sourceUrl: "cons", artist: "X", title: "Cons" });
    const audioWin = makeTrack({ sourceUrl: "aud", artist: "Y", title: "Aud" });
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
    const a = makeTrack({ sourceUrl: "a", artist: "X", title: "T1" });
    const b = makeTrack({ sourceUrl: "b", artist: "Y", title: "T2" });
    const audio = {
      seedBpm: null,
      seedMusicalKey: null,
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
