// Parity guard — see sync comment in genreBuckets.ts and genre_buckets.py GENRE_MAP.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GENRE_MAP, genreToBucket } from "./genreBuckets";

function parsePythonGenreMap(): Record<string, string> {
  const src = readFileSync(join(process.cwd(), "../python-service/app/core/genre_buckets.py"), "utf-8");
  const start = src.indexOf("GENRE_MAP: dict[str, str] = {");
  const end = src.indexOf("}", start);
  const block = src.slice(start, end + 1);
  const result: Record<string, string> = {};
  for (const match of block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) result[key] = value;
  }
  return result;
}

describe("genreBuckets", () => {
  it("TS GENRE_MAP matches Python GENRE_MAP exactly", () => {
    const pyMap = parsePythonGenreMap();
    expect(Object.keys(pyMap).length).toBeGreaterThanOrEqual(20);
    expect(pyMap).toEqual(GENRE_MAP);
  });

  it("genreToBucket(null) returns 'other'", () => {
    expect(genreToBucket(null)).toBe("other");
  });

  it("genreToBucket('Techno') returns 'techno'", () => {
    expect(genreToBucket("Techno")).toBe("techno");
  });
});
