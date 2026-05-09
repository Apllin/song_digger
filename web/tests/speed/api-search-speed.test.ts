/**
 * /api/search end-to-end latency — web → Python → web → DB → response-ready.
 *
 * Wall-clock covers Python /similar (~2s) plus saveTracks Postgres writes
 * (createMany Track + SELECT for id mapping + createMany SearchResult ≈ 3s
 * against Neon us-east-1) plus dislike-filter. After moving from
 * upsert-per-row $transaction chunks to bulk createMany (2026-05-04),
 * observed P95 dropped from ~29s to ~5.5s on a warm DB. Threshold leaves
 * ~2× headroom over that without masking real regressions — if a future
 * change reintroduces N×roundtrip patterns, we'll see it land near the cap.
 *
 * Prerequisite: pnpm dev (web on :3000, python-service on :8000) +
 * Postgres reachable. Test skips if web isn't up.
 *
 * Run with:  pnpm test:speed
 */
import { beforeAll, describe, expect, it } from "vitest";

const WEB_URL = "http://localhost:3000";
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 60_000;

const RUNS = 5;
const P95_THRESHOLD_S = 12;

let serverUp = false;

beforeAll(async () => {
  try {
    serverUp = (await fetch(`${WEB_URL}/api/dislikes`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    serverUp = false;
  }
});

interface SearchStatus {
  id: string;
  status: string;
  tracks: Array<{ artist: string; title: string }>;
}

async function timeOneSearch(input: string): Promise<number> {
  const start = performance.now();
  const post = await fetch(`${WEB_URL}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  const { id } = (await post.json()) as { id: string };

  // Poll until status === 'done'. End-to-end time is from POST start
  // through "done" — the user-visible "results ready" moment.
  const pollDeadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < pollDeadline) {
    const r = await fetch(`${WEB_URL}/api/search/${id}`);
    if (r.ok) {
      const body = (await r.json()) as SearchStatus;
      if (body.status === "done") {
        return (performance.now() - start) / 1000;
      }
      if (body.status === "error") {
        throw new Error(`search ${id} ended with status=error`);
      }
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  throw new Error(`poll timeout for search ${id}`);
}

describe("/api/search speed", () => {
  it(`end-to-end P95 latency for popular seed is < ${P95_THRESHOLD_S}s`, async () => {
    if (!serverUp) {
      console.warn("[skip] web dev server not reachable on :3000");
      return;
    }

    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await timeOneSearch("Oscar Mulero - Horses");
      latencies.push(t);
    }
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(RUNS / 2)];
    const p95 = sorted[sorted.length - 1];
    console.log(
      `[/api/search speed] P50=${p50.toFixed(2)}s  P95=${p95.toFixed(2)}s  ` +
        `runs=${latencies.map((x) => x.toFixed(2)).join(", ")}`,
    );
    expect(p95).toBeLessThan(P95_THRESHOLD_S);
  }, 600_000);
});
