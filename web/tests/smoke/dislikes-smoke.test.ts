/**
 * Dislike-filter smoke — end-to-end CRUD + filter behavior.
 *
 * Prerequisite: dev servers running (pnpm dev) + Postgres reachable
 * via DATABASE_URL.
 *
 * Flow tested:
 *  1. POST /api/dislikes with (artist, title) → row created
 *  2. GET  /api/dislikes returns it
 *  3. POST /api/search → run a real search, dislike the rank-1 result,
 *     re-run — assert that (artistKey, titleKey) is no longer in results.
 *     Identity match uses normalizeArtist/normalizeTitle from the
 *     aggregator (same logic the search route uses to build dislikedKeys).
 *  4. DELETE → cleanup so subsequent test runs aren't polluted.
 *
 * Run with:  pnpm test:smoke
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";

const WEB_URL = "http://localhost:3000";
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 60_000;

const PLACEHOLDER_ARTIST = "Smoke Test Artist";
const PLACEHOLDER_TITLE = "Smoke Test Track";

let serversUp = false;

beforeAll(async () => {
  try {
    const r = await fetch(`${WEB_URL}/api/dislikes`, {
      signal: AbortSignal.timeout(2000),
    });
    serversUp = r.ok;
  } catch {
    serversUp = false;
  }
});

afterEach(async () => {
  // Always remove the placeholder row even on failure paths so the dev
  // DB doesn't accumulate junk.
  if (!serversUp) return;
  await fetch(`${WEB_URL}/api/dislikes`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artist: PLACEHOLDER_ARTIST, title: PLACEHOLDER_TITLE }),
  }).catch(() => {});
});

describe("/api/dislikes CRUD", () => {
  it("POST then GET round-trips", async () => {
    if (!serversUp) {
      console.warn("[skip] web dev server not reachable");
      return;
    }

    const post = await fetch(`${WEB_URL}/api/dislikes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist: PLACEHOLDER_ARTIST, title: PLACEHOLDER_TITLE }),
    });
    expect(post.ok).toBe(true);

    const list = (await fetch(`${WEB_URL}/api/dislikes`).then((r) => r.json())) as Array<{
      artist: string;
      title: string;
    }>;
    const found = list.some((d) => d.artist === PLACEHOLDER_ARTIST && d.title === PLACEHOLDER_TITLE);
    expect(found).toBe(true);
  });

  it("DELETE removes the row", async () => {
    if (!serversUp) {
      console.warn("[skip] web dev server not reachable");
      return;
    }

    await fetch(`${WEB_URL}/api/dislikes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist: PLACEHOLDER_ARTIST, title: PLACEHOLDER_TITLE }),
    });
    const del = await fetch(`${WEB_URL}/api/dislikes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist: PLACEHOLDER_ARTIST, title: PLACEHOLDER_TITLE }),
    });
    expect(del.ok).toBe(true);

    const list = (await fetch(`${WEB_URL}/api/dislikes`).then((r) => r.json())) as Array<{
      artist: string;
      title: string;
    }>;
    const found = list.some((d) => d.artist === PLACEHOLDER_ARTIST && d.title === PLACEHOLDER_TITLE);
    expect(found).toBe(false);
  });

  it("POST with missing fields returns 400", async () => {
    if (!serversUp) {
      console.warn("[skip] web dev server not reachable");
      return;
    }
    const resp = await fetch(`${WEB_URL}/api/dislikes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist: PLACEHOLDER_ARTIST }),
    });
    expect(resp.status).toBe(400);
  });
});

interface SearchTrack {
  artist: string;
  title: string;
  source: string;
  sourceUrl: string;
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
  const body = (await resp.json()) as { id: string };
  return body.id;
}

async function pollUntilDone(id: string): Promise<SearchStatus> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const resp = await fetch(`${WEB_URL}/api/search/${id}`);
    if (resp.ok) {
      const body = (await resp.json()) as SearchStatus;
      if (body.status === "done" || body.status === "error") return body;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("poll timeout");
}

function identityKey(t: { artist: string; title: string }): string {
  return `${normalizeArtist(t.artist)}|${normalizeTitle(t.title)}`;
}

describe("/api/search dislike-filter behavior", () => {
  it("a disliked (artist, title) is not in subsequent search results", async () => {
    if (!serversUp) {
      console.warn("[skip] web dev server not reachable");
      return;
    }

    // First search — pick a real track from the result set as the dislike
    // target. Picking dynamically (instead of hard-coding) keeps the test
    // robust as the catalog evolves.
    const id1 = await startSearch("Oscar Mulero - Horses");
    const r1 = await pollUntilDone(id1);
    expect(r1.status).toBe("done");
    expect(r1.tracks.length).toBeGreaterThan(0);

    const target = r1.tracks[0]!;
    console.log(`[dislike smoke] disliking "${target.artist} - ${target.title}" (rank 1, source=${target.source})`);

    const post = await fetch(`${WEB_URL}/api/dislikes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist: target.artist, title: target.title }),
    });
    expect(post.ok).toBe(true);

    try {
      const id2 = await startSearch("Oscar Mulero - Horses");
      const r2 = await pollUntilDone(id2);
      expect(r2.status).toBe("done");

      const targetKey = identityKey(target);
      const survived = r2.tracks.find((t) => identityKey(t) === targetKey);
      expect(
        survived,
        `disliked ${targetKey} re-appeared in search ${id2} from source ${survived?.source}`,
      ).toBeUndefined();
    } finally {
      await fetch(`${WEB_URL}/api/dislikes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artist: target.artist, title: target.title }),
      });
    }
  }, 180_000);
});
