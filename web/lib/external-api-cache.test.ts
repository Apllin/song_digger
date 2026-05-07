import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const prismaMock = {
  externalApiCache: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { lookupCache, upsertCache } = await import("./external-api-cache");

const consoleSpy = {
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  consoleSpy.log.mockClear();
  consoleSpy.error.mockClear();
});

describe("lookupCache", () => {
  it("returns null on empty source/key (defensive)", async () => {
    expect(await lookupCache("", "key")).toBeNull();
    expect(await lookupCache("src", "")).toBeNull();
    expect(prismaMock.externalApiCache.findUnique).not.toHaveBeenCalled();
  });

  it("returns null on miss and logs MISS", async () => {
    prismaMock.externalApiCache.findUnique.mockResolvedValueOnce(null);
    const result = await lookupCache("itunes_cover", "k1");
    expect(result).toBeNull();
    const logged = consoleSpy.log.mock.calls.map((c) => c[0]).join("\n");
    expect(logged).toContain("outcome=MISS");
    expect(logged).toContain("source=itunes_cover");
  });

  it("returns the payload on hit (no TTL)", async () => {
    prismaMock.externalApiCache.findUnique.mockResolvedValueOnce({
      payload: { url: "https://example/cover.jpg" },
      updatedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    });
    const result = await lookupCache<{ url: string }>("itunes_cover", "k1");
    expect(result).toEqual({ url: "https://example/cover.jpg" });
    expect(consoleSpy.log.mock.calls.map((c) => c[0]).join("\n")).toContain(
      "outcome=HIT",
    );
  });

  it("returns the payload on hit when within TTL", async () => {
    prismaMock.externalApiCache.findUnique.mockResolvedValueOnce({
      payload: [{ id: 1 }],
      updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day old
    });
    const result = await lookupCache<{ id: number }[]>(
      "discogs_artist_releases",
      "k",
      30 * 86400,
    );
    expect(result).toEqual([{ id: 1 }]);
  });

  it("returns null and logs STALE when row exceeds TTL", async () => {
    prismaMock.externalApiCache.findUnique.mockResolvedValueOnce({
      payload: { stale: true },
      updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    const result = await lookupCache(
      "discogs_artist_releases",
      "k",
      30 * 86400,
    );
    expect(result).toBeNull();
    const logged = consoleSpy.log.mock.calls.map((c) => c[0]).join("\n");
    expect(logged).toContain("outcome=STALE");
    expect(logged).toContain("ttl_s=2592000");
  });

  it("treats empty array payloads as hits (not misses)", async () => {
    prismaMock.externalApiCache.findUnique.mockResolvedValueOnce({
      payload: [],
      updatedAt: new Date(),
    });
    const result = await lookupCache<unknown[]>("discogs_search_artist", "k");
    expect(result).toEqual([]);
  });

  it("treats empty object payloads as hits", async () => {
    prismaMock.externalApiCache.findUnique.mockResolvedValueOnce({
      payload: {},
      updatedAt: new Date(),
    });
    const result = await lookupCache<object>("anysrc", "k");
    expect(result).toEqual({});
  });

  it("returns null when Prisma throws (soft-degrade)", async () => {
    prismaMock.externalApiCache.findUnique.mockRejectedValueOnce(
      new Error("connection refused"),
    );
    const result = await lookupCache("itunes_cover", "k");
    expect(result).toBeNull();
    expect(consoleSpy.error).toHaveBeenCalled();
  });

  it("uses composite (source, cacheKey) key in lookup", async () => {
    prismaMock.externalApiCache.findUnique.mockResolvedValueOnce(null);
    await lookupCache("discogs_tracklist", "12345|release");
    const args = prismaMock.externalApiCache.findUnique.mock.calls[0][0];
    expect(args.where.source_cacheKey).toEqual({
      source: "discogs_tracklist",
      cacheKey: "12345|release",
    });
  });
});

describe("upsertCache", () => {
  it("no-ops on empty source/key", async () => {
    await upsertCache("", "k", { x: 1 });
    await upsertCache("s", "", { x: 1 });
    expect(prismaMock.externalApiCache.upsert).not.toHaveBeenCalled();
  });

  it("writes both create and update branches with the same payload", async () => {
    prismaMock.externalApiCache.upsert.mockResolvedValueOnce({});
    await upsertCache("itunes_cover", "k1", { url: "u1" });
    expect(prismaMock.externalApiCache.upsert).toHaveBeenCalledOnce();
    const args = prismaMock.externalApiCache.upsert.mock.calls[0][0];
    expect(args.where.source_cacheKey).toEqual({
      source: "itunes_cover",
      cacheKey: "k1",
    });
    expect(args.create).toMatchObject({
      source: "itunes_cover",
      cacheKey: "k1",
      payload: { url: "u1" },
    });
    expect(args.update).toMatchObject({ payload: { url: "u1" } });
  });

  it("persists empty arrays as valid cache values", async () => {
    prismaMock.externalApiCache.upsert.mockResolvedValueOnce({});
    await upsertCache("discogs_search_artist", "k", []);
    const args = prismaMock.externalApiCache.upsert.mock.calls[0][0];
    expect(args.create.payload).toEqual([]);
  });

  it("swallows DB errors (caller must always succeed)", async () => {
    prismaMock.externalApiCache.upsert.mockRejectedValueOnce(
      new Error("connection refused"),
    );
    await expect(upsertCache("s", "k", { x: 1 })).resolves.toBeUndefined();
    expect(consoleSpy.error).toHaveBeenCalled();
  });
});
