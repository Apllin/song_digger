/**
 * /api/search end-to-end latency — web → Python → web → DB → response.
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
import { hc } from "hono/client";
import { beforeAll, describe, expect, it } from "vitest";

import type { AppType } from "@/lib/hono/app";

const WEB_URL = "http://localhost:3000";
const RUNS = 5;
const P95_THRESHOLD_S = 12;

const client = hc<AppType>(WEB_URL).api;

let serverUp = false;

beforeAll(async () => {
  try {
    const resp = await client.health.$get({}, { init: { signal: AbortSignal.timeout(2000) } });
    const body = await resp.json();
    serverUp = resp.ok && body.python_service === "ok";
  } catch {
    serverUp = false;
  }
});

async function timeOneSearch(input: string): Promise<number> {
  const start = performance.now();
  const resp = await client.search.$post({ json: { input } });
  if (!resp.ok) throw new Error(`POST failed: ${resp.status}`);
  await resp.json();
  return (performance.now() - start) / 1000;
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
    const p50 = sorted[Math.floor(RUNS / 2)]!;
    const p95 = sorted[sorted.length - 1]!;
    console.log(
      `[/api/search speed] P50=${p50.toFixed(2)}s  P95=${p95.toFixed(2)}s  ` +
        `runs=${latencies.map((x) => x.toFixed(2)).join(", ")}`,
    );
    expect(p95).toBeLessThan(P95_THRESHOLD_S);
  }, 600_000);
});
