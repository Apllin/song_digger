/**
 * /api/search smoke — end-to-end web → Python → DB → response.
 *
 * Prerequisite: dev servers running.
 *   pnpm dev            # web on :3000 + python-service on :8000
 *
 * The route fans out to Python /similar, fuses with the aggregator,
 * persists Tracks + SearchResults, and returns the ranked list in one
 * response. Skipped if the dev servers aren't reachable.
 *
 * Run with:  pnpm test:smoke
 */
import { hc } from "hono/client";
import { beforeAll, describe, expect, it } from "vitest";

import type { AppType } from "@/lib/hono/app";

const WEB_URL = "http://localhost:3000";

const client = hc<AppType>(WEB_URL).api;

let serversUp = false;

beforeAll(async () => {
  try {
    const resp = await client.health.$get({}, { init: { signal: AbortSignal.timeout(2000) } });
    const body = await resp.json();
    serversUp = resp.ok && body.python_service === "ok";
  } catch {
    serversUp = false;
  }
});

interface SearchTrack {
  id: string;
  artist: string;
  title: string;
  source: string;
  sourceUrl: string;
  score: number | null;
  sources: string[];
}

interface SearchResponse {
  id: string;
  tracks: SearchTrack[];
}

async function search(input: string): Promise<SearchResponse> {
  const resp = await client.search.$post({ json: { input } });
  expect(resp.ok).toBe(true);
  return resp.json() as Promise<SearchResponse>;
}

describe("/api/search smoke", () => {
  it("returns ≥10 tracks with valid structure for a popular seed", async () => {
    if (!serversUp) {
      console.warn("[skip] web/python dev servers not reachable on :3000/:8000");
      return;
    }

    const { id, tracks } = await search("Oscar Mulero - Horses");
    expect(id).toBeTruthy();
    expect(tracks.length).toBeGreaterThanOrEqual(10);

    for (const t of tracks.slice(0, 5)) {
      expect(t.id).toBeTruthy();
      expect(t.artist).toBeTruthy();
      expect(t.title).toBeTruthy();
      expect(t.source).toBeTruthy();
      expect(t.sourceUrl).toMatch(/^https?:\/\//);
      expect(Array.isArray(t.sources)).toBe(true);
    }

    const topSources = new Set(tracks.slice(0, 20).map((t) => t.source));
    console.log(`[/api/search smoke] top-20 source mix:`, Array.from(topSources));
    expect(topSources.size).toBeGreaterThanOrEqual(3);
  }, 90_000);
});

describe("/api/search smoke — request validation", () => {
  it("rejects missing input with 400", async () => {
    if (!serversUp) {
      console.warn("[skip] web/python dev servers not reachable");
      return;
    }
    // @ts-expect-error intentionally omitting required `input` to verify schema validation
    const resp = await client.search.$post({ json: {} });
    expect(resp.status).toBe(400);
  });

  it("rejects empty string input with 400", async () => {
    if (!serversUp) {
      console.warn("[skip] web/python dev servers not reachable");
      return;
    }
    const resp = await client.search.$post({ json: { input: "" } });
    expect(resp.status).toBe(400);
  });
});
