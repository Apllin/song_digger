import { beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the single search cache layer: the SearchQuery row cache. A repeat
// of a completed (artist, track) within the TTL must be served from persisted
// rows WITHOUT a Python /similar fan-out; a miss must call Python and create a
// new query. (Per-adapter caches were removed — this layer is what makes the
// stateless python service cheap on repeat searches.)

const prismaMock = {
  searchQuery: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  searchResult: { count: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  track: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
};
const findSimilar = vi.fn();
const getActiveWeights = vi.fn();
const resolveAudioFeatures = vi.fn();
const warmEmbedCache = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/python-api/generated/clients/findSimilar", () => ({ findSimilar }));
vi.mock("@/lib/modelWeights", () => ({ getActiveWeights }));
vi.mock("@/features/enrichment/server/resolveAudioFeatures", () => ({ resolveAudioFeatures }));
vi.mock("@/lib/embed-cache", () => ({ warmEmbedCache }));
vi.mock("@/lib/hono/anonGate", () => ({
  anonGate: (_c: unknown, next: () => Promise<void>) => next(),
}));

const { searchApi } = await import("./searchApi");

const WEIGHTS = {
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

const EMPTY_AUDIO = {
  audio: {
    seedBpm: null,
    seedMusicalKey: null,
    seedGenre: null,
    candidateBpm: new Map(),
    candidateMusicalKey: new Map(),
  },
  attemptedUrls: new Set<string>(),
};

async function postSearch(input: string): Promise<Response> {
  return searchApi.request("/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
}

describe("search cache (SearchQuery layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveWeights.mockResolvedValue(WEIGHTS);
    resolveAudioFeatures.mockResolvedValue(EMPTY_AUDIO);
  });

  it("cache HIT: reuses the completed query and skips the Python fan-out", async () => {
    prismaMock.searchQuery.findFirst.mockResolvedValue({ id: "cached-query-id" });
    prismaMock.searchResult.count.mockResolvedValue(2);
    prismaMock.searchResult.findMany.mockResolvedValue([
      {
        id: "r1",
        score: 0.9,
        sources: ["youtube_music"],
        track: {
          id: "t1",
          title: "A",
          artist: "X",
          source: "youtube_music",
          sourceUrl: "https://y/1",
          coverUrl: null,
          embedUrl: null,
          bpm: null,
          musicalKey: null,
        },
      },
      {
        id: "r2",
        score: 0.8,
        sources: ["lastfm"],
        track: {
          id: "t2",
          title: "B",
          artist: "Y",
          source: "lastfm",
          sourceUrl: "https://l/2",
          coverUrl: null,
          embedUrl: null,
          bpm: null,
          musicalKey: null,
        },
      },
    ]);

    const res = await postSearch("Oscar Mulero - Horses");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; tracks: unknown[] };
    expect(body.id).toBe("cached-query-id");
    expect(body.tracks).toHaveLength(2);

    // The whole point of the cache: no Python call, no new query row.
    expect(findSimilar).not.toHaveBeenCalled();
    expect(prismaMock.searchQuery.create).not.toHaveBeenCalled();
  });

  it("cache MISS: calls Python and creates a new query", async () => {
    prismaMock.searchQuery.findFirst.mockResolvedValue(null);
    prismaMock.searchQuery.create.mockResolvedValue({ id: "new-query-id" });
    prismaMock.searchQuery.update.mockResolvedValue({});
    findSimilar.mockResolvedValue({ source_lists: [], source_artist: null });
    prismaMock.searchResult.count.mockResolvedValue(0);
    prismaMock.searchResult.findMany.mockResolvedValue([]);

    const res = await postSearch("Some Unknown - Track");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("new-query-id");
    expect(findSimilar).toHaveBeenCalledTimes(1);
    expect(prismaMock.searchQuery.create).toHaveBeenCalledTimes(1);
  });

  it("cache key is TTL-bounded and status-gated (a stale/running query is not a hit)", async () => {
    prismaMock.searchQuery.findFirst.mockResolvedValue(null);
    prismaMock.searchQuery.create.mockResolvedValue({ id: "fresh-id" });
    prismaMock.searchQuery.update.mockResolvedValue({});
    findSimilar.mockResolvedValue({ source_lists: [], source_artist: null });
    prismaMock.searchResult.count.mockResolvedValue(0);
    prismaMock.searchResult.findMany.mockResolvedValue([]);

    await postSearch("Oscar Mulero - Horses");

    const where = prismaMock.searchQuery.findFirst.mock.calls[0]?.[0]?.where;
    expect(where.status).toBe("done");
    expect(where.cacheKey).toMatch(/^v\d+:/); // versioned key
    expect(where.createdAt?.gte).toBeInstanceOf(Date); // TTL cutoff applied
  });
});
