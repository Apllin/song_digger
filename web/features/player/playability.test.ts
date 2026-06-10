import { describe, expect, it } from "vitest";
import { canAdapterPlay, needsEmbedResolution } from "./playability";
import type { PlayerTrack } from "./types";

function track(overrides: Partial<PlayerTrack>): PlayerTrack {
  return {
    id: "1",
    title: "Title",
    artist: "Artist",
    source: null,
    sourceUrl: "",
    ...overrides,
  };
}

describe("canAdapterPlay", () => {
  it("plays a youtube_music row with a resolvable video id", () => {
    expect(canAdapterPlay(track({ source: "youtube_music", sourceUrl: "https://x/watch?v=abc" }))).toBe(true);
  });

  it("cannot play a youtube_music row missing a video id", () => {
    expect(canAdapterPlay(track({ source: "youtube_music", sourceUrl: "https://x/browse" }))).toBe(false);
  });

  it("plays a bandcamp row that has a sourceUrl", () => {
    expect(canAdapterPlay(track({ source: "bandcamp", sourceUrl: "https://x.bandcamp.com/track/y" }))).toBe(true);
  });

  it("plays a soundcloud row that has an embedUrl", () => {
    expect(canAdapterPlay(track({ source: "soundcloud", embedUrl: "https://w.soundcloud.com/player" }))).toBe(true);
  });

  it("cannot play non-playable sources", () => {
    for (const source of ["cosine_club", "lastfm", "yandex_music", "trackidnet", "discogs"] as const) {
      expect(canAdapterPlay(track({ source }))).toBe(false);
    }
  });

  it("cannot play a null source", () => {
    expect(canAdapterPlay(track({ source: null }))).toBe(false);
  });
});

describe("needsEmbedResolution", () => {
  it("does not resolve a directly-playable row", () => {
    expect(needsEmbedResolution(track({ source: "youtube_music", sourceUrl: "https://x/watch?v=abc" }))).toBe(false);
  });

  it("resolves a non-playable source", () => {
    expect(needsEmbedResolution(track({ source: "cosine_club" }))).toBe(true);
  });

  it("resolves a playable source whose adapter data is missing", () => {
    expect(needsEmbedResolution(track({ source: "youtube_music", sourceUrl: "https://x/browse" }))).toBe(true);
  });

  it("skips resolution when title or artist is empty", () => {
    expect(needsEmbedResolution(track({ source: "cosine_club", title: "" }))).toBe(false);
    expect(needsEmbedResolution(track({ source: "cosine_club", artist: "" }))).toBe(false);
  });
});
