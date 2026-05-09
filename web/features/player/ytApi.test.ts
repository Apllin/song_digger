import { describe, expect, it } from "vitest";
import { extractVideoId } from "./ytApi";

describe("extractVideoId", () => {
  describe("youtube_music source — reads from sourceUrl", () => {
    it("extracts the video ID from a standard YTM watch URL", () => {
      expect(extractVideoId("youtube_music", "https://music.youtube.com/watch?v=dQw4w9WgXcQ", null)).toBe(
        "dQw4w9WgXcQ",
      );
    });

    it("stops at the first & so extra query params are stripped", () => {
      expect(
        extractVideoId("youtube_music", "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc&index=1", null),
      ).toBe("dQw4w9WgXcQ");
    });

    it("returns null when the URL has no v= parameter", () => {
      expect(extractVideoId("youtube_music", "https://music.youtube.com/browse", null)).toBeNull();
    });

    it("returns null when sourceUrl is null", () => {
      expect(extractVideoId("youtube_music", null, null)).toBeNull();
    });

    it("returns null when sourceUrl is undefined", () => {
      expect(extractVideoId("youtube_music", undefined, null)).toBeNull();
    });

    it("ignores embedUrl entirely when source is youtube_music", () => {
      expect(extractVideoId("youtube_music", null, "https://www.youtube.com/embed/shouldBeIgnored")).toBeNull();
    });
  });

  describe("other sources — reads from embedUrl", () => {
    it("extracts the video ID from a plain YouTube embed URL", () => {
      expect(extractVideoId("cosine_club", null, "https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("stops at the first ? so query params are stripped", () => {
      expect(extractVideoId("lastfm", null, "https://www.youtube.com/embed/dQw4w9WgXcQ?si=abc&start=0")).toBe(
        "dQw4w9WgXcQ",
      );
    });

    it("returns null when embedUrl is null", () => {
      expect(extractVideoId("cosine_club", null, null)).toBeNull();
    });

    it("returns null when embedUrl is undefined", () => {
      expect(extractVideoId("cosine_club", null, undefined)).toBeNull();
    });

    it("works when source is null", () => {
      expect(extractVideoId(null, null, "https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("returns null when source is null and embedUrl is also null", () => {
      expect(extractVideoId(null, null, null)).toBeNull();
    });
  });
});
