import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedFetch, devCacheClear, devCacheSize } from "./dev-cache";

function mockFetch() {
  let counter = 0;
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    counter += 1;
    return new Response(JSON.stringify({ n: counter }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("cachedFetch", () => {
  beforeEach(() => {
    devCacheClear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("passes through when DEV_CACHE is unset", async () => {
    const fn = mockFetch();

    const a = await cachedFetch("https://x/y");
    const b = await cachedFetch("https://x/y");

    expect(fn).toHaveBeenCalledTimes(2);
    expect(await a.json()).toEqual({ n: 1 });
    expect(await b.json()).toEqual({ n: 2 });
    expect(devCacheSize()).toBe(0);
  });

  it("returns the same body on a cache hit", async () => {
    vi.stubEnv("DEV_CACHE", "1");
    const fn = mockFetch();

    const a = await cachedFetch("https://x/y");
    const b = await cachedFetch("https://x/y");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(await a.json()).toEqual({ n: 1 });
    expect(await b.json()).toEqual({ n: 1 });
    expect(devCacheSize()).toBe(1);
  });

  it("keys POST requests by body", async () => {
    vi.stubEnv("DEV_CACHE", "1");
    const fn = mockFetch();

    await cachedFetch("https://x/similar", {
      method: "POST",
      body: JSON.stringify({ artist: "Burial" }),
    });
    await cachedFetch("https://x/similar", {
      method: "POST",
      body: JSON.stringify({ artist: "Burial" }),
    });
    await cachedFetch("https://x/similar", {
      method: "POST",
      body: JSON.stringify({ artist: "Surgeon" }),
    });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(devCacheSize()).toBe(2);
  });

  it("does not cache non-2xx responses", async () => {
    vi.stubEnv("DEV_CACHE", "1");
    const fn = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fn);

    await cachedFetch("https://x/y");
    await cachedFetch("https://x/y");

    expect(fn).toHaveBeenCalledTimes(2);
    expect(devCacheSize()).toBe(0);
  });

  it("can be toggled via env at call time (no module reload needed)", async () => {
    const fn = mockFetch();

    await cachedFetch("https://x/y"); // off → fetch
    vi.stubEnv("DEV_CACHE", "1");
    await cachedFetch("https://x/y"); // on, miss → fetch + store
    await cachedFetch("https://x/y"); // on, hit
    vi.stubEnv("DEV_CACHE", "0");
    await cachedFetch("https://x/y"); // off → fetch again

    expect(fn).toHaveBeenCalledTimes(3);
  });
});
