import { describe, expect, it } from "vitest";
import { parseQuery } from "./parse-query";

describe("parseQuery", () => {
  it("splits 'Artist - Track' into artist + track", () => {
    expect(parseQuery("Surgeon - Flatliner")).toEqual({
      artist: "Surgeon",
      track: "Flatliner",
      raw: "Surgeon - Flatliner",
    });
  });

  it("returns track=null for artist-only input", () => {
    expect(parseQuery("Surgeon")).toEqual({
      artist: "Surgeon",
      track: null,
      raw: "Surgeon",
    });
  });

  it("trims surrounding whitespace from raw, artist, and track", () => {
    expect(parseQuery("  Surgeon  -  Flatliner  ")).toEqual({
      artist: "Surgeon",
      track: "Flatliner",
      raw: "Surgeon  -  Flatliner",
    });
  });

  it("only splits on ' - ' (space-dash-space), not bare hyphens", () => {
    // "Jean-Michel Jarre" must stay together as the artist.
    expect(parseQuery("Jean-Michel Jarre")).toEqual({
      artist: "Jean-Michel Jarre",
      track: null,
      raw: "Jean-Michel Jarre",
    });
  });

  it("splits on the FIRST ' - ' so hyphenated tracks work", () => {
    // "Foo - Bar - Baz Remix" → artist="Foo", track="Bar - Baz Remix"
    expect(parseQuery("Foo - Bar - Baz Remix")).toEqual({
      artist: "Foo",
      track: "Bar - Baz Remix",
      raw: "Foo - Bar - Baz Remix",
    });
  });

  it("a bare 'X -' (no trailing space-dash-space) is treated as artist-only", () => {
    // raw is already trimmed, so 'Artist -' has no ' - ' substring → artist-only path.
    expect(parseQuery("Artist - ")).toEqual({
      artist: "Artist -",
      track: null,
      raw: "Artist -",
    });
  });
});
