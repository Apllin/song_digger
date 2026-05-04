/**
 * /api/search smoke — end-to-end web → Python → DB → response.
 *
 * Prerequisite: dev servers running.
 *   pnpm dev            # web on :3000 + python-service on :8000
 *
 * The route persists a SearchQuery, fans out to Python /similar, fuses
 * with the aggregator, persists Tracks + SearchResults, and returns a
 * SearchQuery id. Polling on the SearchQuery row tells us when it
 * finished. Skipped if the dev servers aren't reachable.
 *
 * Run with:  pnpm test:smoke
 */
import { describe, it, expect, beforeAll } from "vitest";

const WEB_URL = "http://localhost:3000";
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 60_000;

let serversUp = false;

beforeAll(async () => {
  try {
    const [web, py] = await Promise.all([
      fetch(`${WEB_URL}/api/dislikes`, {
        signal: AbortSignal.timeout(2000),
      }).then((r) => r.ok),
      fetch("http://localhost:8000/health", {
        signal: AbortSignal.timeout(2000),
      }).then((r) => r.ok),
    ]);
    serversUp = web && py;
  } catch {
    serversUp = false;
  }
});

interface SearchTrack {
  artist: string;
  title: string;
  source: string;
  sourceUrl: string;
  score: number | null;
}

interface SearchStatus {
  id: string;
  status: string;
  tracks: SearchTrack[];
}

async function startSearch(input: string): Promise<string> {
  const resp = await fetch(`${WEB_URL}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  expect(resp.ok).toBe(true);
  const body = (await resp.json()) as { id: string; status: string };
  expect(body.id).toBeTruthy();
  return body.id;
}

async function pollUntilDone(searchId: string): Promise<SearchStatus> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const resp = await fetch(`${WEB_URL}/api/search/${searchId}`);
    if (resp.ok) {
      const body = (await resp.json()) as SearchStatus;
      if (body.status === "done" || body.status === "error") return body;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`search ${searchId} did not finish within ${POLL_TIMEOUT_MS}ms`);
}

describe("/api/search smoke", () => {
  it("returns ≥10 tracks with valid structure for a popular seed", async () => {
    if (!serversUp) {
      console.warn("[skip] web/python dev servers not reachable on :3000/:8000");
      return;
    }

    const id = await startSearch("Oscar Mulero - Horses");
    const final = await pollUntilDone(id);
    expect(final.status).toBe("done");
    expect(final.tracks.length).toBeGreaterThanOrEqual(10);

    for (const t of final.tracks.slice(0, 5)) {
      expect(t.artist).toBeTruthy();
      expect(t.title).toBeTruthy();
      expect(t.source).toBeTruthy();
      expect(t.sourceUrl).toMatch(/^https?:\/\//);
    }

    // Multiple source badges should be represented in the top-20 — RRF
    // coverage check, not single-source dominance.
    const topSources = new Set(final.tracks.slice(0, 20).map((t) => t.source));
    console.log(
      `[/api/search smoke] top-20 source mix:`,
      Array.from(topSources),
    );
    expect(topSources.size).toBeGreaterThanOrEqual(3);
  }, 90_000);
});

describe("/api/search smoke — request validation", () => {
  it("rejects missing input with 400", async () => {
    if (!serversUp) {
      console.warn("[skip] web/python dev servers not reachable");
      return;
    }
    const resp = await fetch(`${WEB_URL}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
  });

  it("rejects empty string input with 400", async () => {
    if (!serversUp) {
      console.warn("[skip] web/python dev servers not reachable");
      return;
    }
    const resp = await fetch(`${WEB_URL}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "" }),
    });
    expect(resp.status).toBe(400);
  });
});
