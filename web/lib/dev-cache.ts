/**
 * In-memory fetch cache for local development. Gated by DEV_CACHE=1.
 * Keyed on method + URL + body. No TTL — Map lives until the module
 * reloads (HMR / restart). Only 2xx responses are stored.
 *
 * Off by default. In production keep DEV_CACHE unset so every call
 * hits the upstream.
 */

type Entry = {
  status: number;
  headers: [string, string][];
  body: string;
};

const cache = new Map<string, Entry>();

function isEnabled(): boolean {
  return process.env.DEV_CACHE === "1";
}

function keyOf(input: RequestInfo | URL, init?: RequestInit): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? String(init.body) : "";
  return `${method} ${url} ${body}`;
}

function toResponse(entry: Entry): Response {
  return new Response(entry.body, {
    status: entry.status,
    headers: entry.headers,
  });
}

function shortKey(k: string): string {
  return k.length > 100 ? `${k.slice(0, 100)}…` : k;
}

export function devCacheClear(): void {
  cache.clear();
}

export function devCacheSize(): number {
  return cache.size;
}

export async function cachedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isEnabled()) return fetch(input, init);

  const k = keyOf(input, init);
  const hit = cache.get(k);
  if (hit) {
    console.log(`[dev-cache] HIT  ${shortKey(k)}`);
    return toResponse(hit);
  }

  console.log(`[dev-cache] MISS ${shortKey(k)}`);
  const res = await fetch(input, init);
  if (!res.ok) return res;

  const body = await res.text();
  const entry: Entry = {
    status: res.status,
    headers: [...res.headers.entries()],
    body,
  };
  cache.set(k, entry);
  return toResponse(entry);
}
