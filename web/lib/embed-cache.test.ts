import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  trackEmbed: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    createMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { embedCacheKey, lookupEmbedCache, upsertEmbedCache, warmEmbedCache } = await import("./embed-cache");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("embedCacheKey", () => {
  it("normalizes diacritics and case in artist", () => {
    const k = embedCacheKey("Óscar Mulero", "Voices");
    expect(k.artistKey).toBe("oscarmulero");
    expect(k.titleKey).toBe("voices");
  });

  it("strips Discogs (N) suffix from artist", () => {
    expect(embedCacheKey("Voicex (2)", "Track").artistKey).toBe("voicex");
    expect(embedCacheKey("Voicex", "Track").artistKey).toBe("voicex");
  });

  it("collapses '(Original Mix)' suffix on title", () => {
    expect(embedCacheKey("X", "Voices (Original Mix)").titleKey).toBe("voices");
    expect(embedCacheKey("X", "Voices").titleKey).toBe("voices");
  });
});

describe("lookupEmbedCache", () => {
  it("returns null on miss", async () => {
    prismaMock.trackEmbed.findUnique.mockResolvedValueOnce(null);
    const result = await lookupEmbedCache("Mulero", "Voices");
    expect(result).toBeNull();
  });

  it("returns positive hits regardless of age", async () => {
    prismaMock.trackEmbed.findUnique.mockResolvedValueOnce({
      embedUrl: "https://www.youtube.com/embed/abc",
      source: "youtube_music",
      sourceUrl: "https://music.youtube.com/watch?v=abc",
      coverUrl: null,
      updatedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    });
    const result = await lookupEmbedCache("Mulero", "Voices");
    expect(result?.embedUrl).toBe("https://www.youtube.com/embed/abc");
    expect(result?.source).toBe("youtube_music");
  });

  it("returns fresh negative hits within 7d (no re-resolution needed)", async () => {
    prismaMock.trackEmbed.findUnique.mockResolvedValueOnce({
      embedUrl: null,
      source: null,
      sourceUrl: null,
      coverUrl: null,
      updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    const result = await lookupEmbedCache("Mulero", "Voices");
    expect(result).toEqual({
      embedUrl: null,
      source: null,
      sourceUrl: null,
      coverUrl: null,
    });
  });

  it("treats stale negative (> 7d) as miss to force re-resolution", async () => {
    prismaMock.trackEmbed.findUnique.mockResolvedValueOnce({
      embedUrl: null,
      source: null,
      sourceUrl: null,
      coverUrl: null,
      updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const result = await lookupEmbedCache("Mulero", "Voices");
    expect(result).toBeNull();
  });

  it("looks up by normalized composite key", async () => {
    prismaMock.trackEmbed.findUnique.mockResolvedValueOnce(null);
    await lookupEmbedCache("Óscar Mulero (3)", "Voices (Original Mix)");
    const args = prismaMock.trackEmbed.findUnique.mock.calls[0]![0];
    expect(args.where.artistKey_titleKey).toEqual({
      artistKey: "oscarmulero",
      titleKey: "voices",
    });
  });

  it("skips the query when normalization yields empty keys", async () => {
    const result = await lookupEmbedCache("(2)", "");
    expect(result).toBeNull();
    expect(prismaMock.trackEmbed.findUnique).not.toHaveBeenCalled();
  });
});

describe("upsertEmbedCache", () => {
  it("writes positive entries with full metadata", async () => {
    prismaMock.trackEmbed.upsert.mockResolvedValueOnce({});
    await upsertEmbedCache("Mulero", "Voices", {
      embedUrl: "https://www.youtube.com/embed/abc",
      source: "youtube_music",
      sourceUrl: "https://music.youtube.com/watch?v=abc",
      coverUrl: "https://cdn/cover.jpg",
    });
    expect(prismaMock.trackEmbed.upsert).toHaveBeenCalledOnce();
    const args = prismaMock.trackEmbed.upsert.mock.calls[0]![0];
    expect(args.where.artistKey_titleKey).toEqual({
      artistKey: "mulero",
      titleKey: "voices",
    });
    expect(args.create.embedUrl).toBe("https://www.youtube.com/embed/abc");
    expect(args.update.embedUrl).toBe("https://www.youtube.com/embed/abc");
  });

  it("writes negative entries (null embedUrl) so we don't keep retrying YTM", async () => {
    prismaMock.trackEmbed.upsert.mockResolvedValueOnce({});
    await upsertEmbedCache("Mulero", "Voices", {
      embedUrl: null,
      source: null,
      sourceUrl: null,
      coverUrl: null,
    });
    const args = prismaMock.trackEmbed.upsert.mock.calls[0]![0];
    expect(args.create.embedUrl).toBeNull();
    expect(args.create.source).toBeNull();
  });

  it("no-ops on empty key (defensive — never writes garbage rows)", async () => {
    await upsertEmbedCache("", "", {
      embedUrl: null,
      source: null,
      sourceUrl: null,
      coverUrl: null,
    });
    expect(prismaMock.trackEmbed.upsert).not.toHaveBeenCalled();
  });
});

describe("warmEmbedCache", () => {
  it("bulk-inserts only tracks with an embedUrl, skipping duplicates", async () => {
    prismaMock.trackEmbed.createMany.mockResolvedValueOnce({ count: 2 });
    await warmEmbedCache([
      {
        artist: "Mulero",
        title: "Voices",
        embedUrl: "https://www.youtube.com/embed/a",
        sourceUrl: "https://music.youtube.com/watch?v=a",
        source: "youtube_music",
        coverUrl: null,
      },
      {
        artist: "Lewis Fautzi",
        title: "Resonance",
        embedUrl: "https://bandcamp.com/EmbeddedPlayer/track=99/",
        sourceUrl: "https://lewisfautzi.bandcamp.com/track/resonance",
        source: "bandcamp",
        coverUrl: null,
      },
      // No embedUrl — must be filtered out (we never speculatively cache negatives).
      { artist: "Ignez", title: "Nothing", embedUrl: null },
    ]);
    expect(prismaMock.trackEmbed.createMany).toHaveBeenCalledOnce();
    const args = prismaMock.trackEmbed.createMany.mock.calls[0]![0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toHaveLength(2);
    expect(args.data.map((r: { artistKey: string }) => r.artistKey)).toEqual(["mulero", "lewisfautzi"]);
  });

  it("no-ops when nothing has an embedUrl (avoids empty createMany)", async () => {
    await warmEmbedCache([
      { artist: "A", title: "B", embedUrl: null },
      { artist: "C", title: "D" },
    ]);
    expect(prismaMock.trackEmbed.createMany).not.toHaveBeenCalled();
  });
});
