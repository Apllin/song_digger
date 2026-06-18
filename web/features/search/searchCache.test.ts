import { describe, expect, it } from "vitest";
import { SEARCH_CACHE_SOURCE, SEARCH_CACHE_TTL_SECONDS, SEARCH_CACHE_VERSION, searchCacheKey } from "./searchCache";

describe("searchCacheKey", () => {
  it("prefixes with the version constant", () => {
    expect(searchCacheKey("Mulero", "Voices")).toBe(`${SEARCH_CACHE_VERSION}:mulero|voices`);
  });

  it("collapses case and whitespace differences", () => {
    expect(searchCacheKey("OSCAR MULERO", "VOICES")).toBe(searchCacheKey("oscar mulero", "voices"));
  });

  it("collapses internal whitespace", () => {
    expect(searchCacheKey("oscar  mulero", "voices")).toBe(searchCacheKey("oscar mulero", "voices"));
  });

  it("uses '_' sentinel for artist-only searches (track=null)", () => {
    expect(searchCacheKey("Mulero", null)).toBe(`${SEARCH_CACHE_VERSION}:mulero|_`);
  });

  it("artist-only and (artist, '') produce the same effective key (both = sentinel)", () => {
    // Empty track string is falsy → sentinel branch fires.
    expect(searchCacheKey("Mulero", "")).toBe(searchCacheKey("Mulero", null));
  });

  it("artist-only key differs from (artist, track) key", () => {
    expect(searchCacheKey("Mulero", null)).not.toBe(searchCacheKey("Mulero", "Voices"));
  });

  it("different artists produce different keys", () => {
    expect(searchCacheKey("Mulero", "Voices")).not.toBe(searchCacheKey("Charlton", "Voices"));
  });

  it("different tracks produce different keys", () => {
    expect(searchCacheKey("Mulero", "Voices")).not.toBe(searchCacheKey("Mulero", "Horses"));
  });
});

describe("search cache invariants", () => {
  it("source identifier is stable (never refactor without flushing the table)", () => {
    expect(SEARCH_CACHE_SOURCE).toBe("search_response");
  });

  it("TTL is 14 days in seconds", () => {
    expect(SEARCH_CACHE_TTL_SECONDS).toBe(14 * 24 * 60 * 60);
  });

  it("version constant is part of the key — bumping it forces fresh keys", () => {
    expect(SEARCH_CACHE_VERSION).toMatch(/^v\d+$/);
    expect(searchCacheKey("a", "b")).toContain(`${SEARCH_CACHE_VERSION}:`);
  });
});
