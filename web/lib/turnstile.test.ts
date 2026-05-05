import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  vi.resetModules();
  fetchMock.mockReset();
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TURNSTILE_SECRET_KEY;
});

async function loadVerify() {
  const mod = await import("./turnstile");
  return mod.verifyTurnstileToken;
}

describe("verifyTurnstileToken", () => {
  it("returns false on empty token without hitting siteverify", async () => {
    const verify = await loadVerify();
    expect(await verify("")).toBe(false);
    expect(await verify(undefined)).toBe(false);
    expect(await verify(null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when TURNSTILE_SECRET_KEY is unset", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const verify = await loadVerify();
    expect(await verify("any-token")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns true on { success: true } from Cloudflare", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const verify = await loadVerify();
    expect(await verify("good-token")).toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("secret")).toBe("test-secret");
    expect(body.get("response")).toBe("good-token");
  });

  it("returns false on { success: false }", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, "error-codes": ["bad-request"] }),
        { status: 200 },
      ),
    );
    const verify = await loadVerify();
    expect(await verify("bad-token")).toBe(false);
  });

  it("fails closed on network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const verify = await loadVerify();
    expect(await verify("token")).toBe(false);
  });

  it("fails closed on non-2xx HTTP response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("server error", { status: 500 }));
    const verify = await loadVerify();
    expect(await verify("token")).toBe(false);
  });

  it("forwards remoteip and idempotency_key when provided", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const verify = await loadVerify();
    await verify("tok", {
      remoteIp: "203.0.113.5",
      idempotencyKey: "abc-123",
    });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("remoteip")).toBe("203.0.113.5");
    expect(body.get("idempotency_key")).toBe("abc-123");
  });
});
