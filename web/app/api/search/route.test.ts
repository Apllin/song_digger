import { describe, it, expect, vi } from "vitest";

// Route module imports prisma + auth + python-client at module scope; mock
// them so this unit test stays offline. We're only exercising the pure
// cache-key helper + the version/source/TTL constants.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/python-client", () => ({ fetchSimilarTracks: vi.fn() }));
vi.mock("@/lib/external-api-cache", () => ({
  lookupCache: vi.fn(),
  upsertCache: vi.fn(),
}));
vi.mock("@/lib/embed-cache", () => ({ warmEmbedCache: vi.fn() }));
vi.mock("@/lib/cover-enrichment", () => ({ enrichMissingCovers: vi.fn() }));
vi.mock("@/lib/anonymous-counter", () => ({ gateAnonymousRequest: vi.fn() }));

const { searchCacheKey, _internals } = await import("./route");

describe("searchCacheKey", () => {
  it("prefixes with the version constant", () => {
    expect(searchCacheKey("Mulero", "Voices")).toBe(
      `${_internals.SEARCH_CACHE_VERSION}:mulero|voices`,
    );
  });

  it("normalizes diacritics on the artist", () => {
    expect(searchCacheKey("Óscar Mulero", "Voices")).toBe(
      searchCacheKey("Oscar Mulero", "Voices"),
    );
  });

  it("collapses case and whitespace differences via normalize*", () => {
    expect(searchCacheKey("OSCAR MULERO", "VOICES")).toBe(
      searchCacheKey("oscar mulero", "voices"),
    );
  });

  it("strips '(Original Mix)' from track via normalizeTitle", () => {
    expect(searchCacheKey("Mulero", "Voices (Original Mix)")).toBe(
      searchCacheKey("Mulero", "Voices"),
    );
  });

  it("uses '_' sentinel for artist-only searches (track=null)", () => {
    expect(searchCacheKey("Mulero", null)).toBe(
      `${_internals.SEARCH_CACHE_VERSION}:mulero|_`,
    );
  });

  it("artist-only and (artist, '') produce the same effective key (both = sentinel)", () => {
    // Empty track string is falsy → sentinel branch fires.
    expect(searchCacheKey("Mulero", "")).toBe(searchCacheKey("Mulero", null));
  });

  it("artist-only key differs from (artist, track) key", () => {
    expect(searchCacheKey("Mulero", null)).not.toBe(
      searchCacheKey("Mulero", "Voices"),
    );
  });

  it("different artists produce different keys", () => {
    expect(searchCacheKey("Mulero", "Voices")).not.toBe(
      searchCacheKey("Charlton", "Voices"),
    );
  });

  it("different tracks produce different keys", () => {
    expect(searchCacheKey("Mulero", "Voices")).not.toBe(
      searchCacheKey("Mulero", "Horses"),
    );
  });
});

describe("search cache invariants", () => {
  it("source identifier is stable (never refactor without flushing the table)", () => {
    expect(_internals.SEARCH_CACHE_SOURCE).toBe("search_response");
  });

  it("TTL is 14 days in seconds", () => {
    expect(_internals.SEARCH_CACHE_TTL_SECONDS).toBe(14 * 24 * 60 * 60);
  });

  it("version constant is part of the key — bumping it forces fresh keys", () => {
    // Sanity: if someone mutates SEARCH_CACHE_VERSION, all keys change.
    // We're not testing that here (would need module reload); instead we
    // verify the prefix is non-empty and present in the rendered key.
    expect(_internals.SEARCH_CACHE_VERSION).toMatch(/^v\d+$/);
    expect(searchCacheKey("a", "b")).toContain(`${_internals.SEARCH_CACHE_VERSION}:`);
  });
});
