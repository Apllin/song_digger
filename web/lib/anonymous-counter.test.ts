import { beforeEach, describe, expect, it, vi } from "vitest";

const headerStore = new Map<string, string>();
const prismaMock = {
  anonymousRequest: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => headerStore.get(key.toLowerCase()) ?? null,
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const {
  ANON_LIMIT,
  ANON_WINDOW_MS,
  getRequestIp,
  checkAnonymousLimit,
  incrementAnonymousCounter,
  gateAnonymousRequest,
} = await import("./anonymous-counter");

const freshFirstAt = () => new Date();
const expiredFirstAt = () => new Date(Date.now() - ANON_WINDOW_MS - 1000);

beforeEach(() => {
  headerStore.clear();
  vi.clearAllMocks();
});

describe("getRequestIp", () => {
  it("uses x-forwarded-for and trims first hop", async () => {
    headerStore.set("x-forwarded-for", "203.0.113.5, 198.51.100.10");
    expect(await getRequestIp()).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for absent", async () => {
    headerStore.set("x-real-ip", "10.0.0.1");
    expect(await getRequestIp()).toBe("10.0.0.1");
  });

  it("returns 'unknown' when no proxy header is set", async () => {
    expect(await getRequestIp()).toBe("unknown");
  });
});

describe("checkAnonymousLimit", () => {
  it("treats missing row as count=0", async () => {
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce(null);
    const result = await checkAnonymousLimit("1.2.3.4");
    expect(result).toEqual({ overLimit: false, count: 0, remaining: ANON_LIMIT });
  });

  it("returns remaining < ANON_LIMIT once count is non-zero", async () => {
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({
      count: 3,
      firstAt: freshFirstAt(),
    });
    const result = await checkAnonymousLimit("1.2.3.4");
    expect(result).toEqual({ overLimit: false, count: 3, remaining: ANON_LIMIT - 3 });
  });

  it("flags overLimit at exactly ANON_LIMIT", async () => {
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({
      count: ANON_LIMIT,
      firstAt: freshFirstAt(),
    });
    const result = await checkAnonymousLimit("1.2.3.4");
    expect(result.overLimit).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("treats count as 0 when firstAt is older than the window", async () => {
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({
      count: ANON_LIMIT,
      firstAt: expiredFirstAt(),
    });
    const result = await checkAnonymousLimit("1.2.3.4");
    expect(result).toEqual({ overLimit: false, count: 0, remaining: ANON_LIMIT });
  });
});

describe("incrementAnonymousCounter", () => {
  it("creates a fresh row when no prior request exists", async () => {
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce(null);
    prismaMock.anonymousRequest.upsert.mockResolvedValueOnce({});
    await incrementAnonymousCounter("9.9.9.9");
    expect(prismaMock.anonymousRequest.upsert).toHaveBeenCalledOnce();
    const args = prismaMock.anonymousRequest.upsert.mock.calls[0]![0];
    expect(args.where).toEqual({ ip: "9.9.9.9" });
    expect(args.create).toEqual({ ip: "9.9.9.9", count: 1 });
    expect(args.update.count).toBe(1);
    expect(args.update.firstAt).toBeInstanceOf(Date);
    expect(args.update.lastAt).toBeInstanceOf(Date);
  });

  it("increments existing row inside the window", async () => {
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({ firstAt: freshFirstAt() });
    prismaMock.anonymousRequest.update.mockResolvedValueOnce({});
    await incrementAnonymousCounter("9.9.9.9");
    expect(prismaMock.anonymousRequest.upsert).not.toHaveBeenCalled();
    expect(prismaMock.anonymousRequest.update).toHaveBeenCalledOnce();
    const args = prismaMock.anonymousRequest.update.mock.calls[0]![0];
    expect(args.where).toEqual({ ip: "9.9.9.9" });
    expect(args.data.count).toEqual({ increment: 1 });
    expect(args.data.lastAt).toBeInstanceOf(Date);
  });

  it("resets count to 1 when prior firstAt is past the window", async () => {
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({ firstAt: expiredFirstAt() });
    prismaMock.anonymousRequest.upsert.mockResolvedValueOnce({});
    await incrementAnonymousCounter("9.9.9.9");
    expect(prismaMock.anonymousRequest.upsert).toHaveBeenCalledOnce();
    const args = prismaMock.anonymousRequest.upsert.mock.calls[0]![0];
    expect(args.update.count).toBe(1);
    expect(args.update.firstAt).toBeInstanceOf(Date);
  });
});

describe("gateAnonymousRequest", () => {
  it("returns ok and increments when under limit inside the window", async () => {
    headerStore.set("x-forwarded-for", "5.5.5.5");
    prismaMock.anonymousRequest.findUnique
      .mockResolvedValueOnce({ count: ANON_LIMIT - 1, firstAt: freshFirstAt() })
      .mockResolvedValueOnce({ firstAt: freshFirstAt() });
    prismaMock.anonymousRequest.update.mockResolvedValueOnce({});

    const result = await gateAnonymousRequest();
    expect(result.ok).toBe(true);
    expect(prismaMock.anonymousRequest.update).toHaveBeenCalledOnce();
  });

  it("returns not-ok and skips increment when at limit inside the window", async () => {
    headerStore.set("x-forwarded-for", "5.5.5.5");
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({
      count: ANON_LIMIT,
      firstAt: freshFirstAt(),
    });

    const result = await gateAnonymousRequest();
    expect(result.ok).toBe(false);
    expect(prismaMock.anonymousRequest.upsert).not.toHaveBeenCalled();
    expect(prismaMock.anonymousRequest.update).not.toHaveBeenCalled();
  });

  it("returns ok and resets when prior firstAt is past the window", async () => {
    headerStore.set("x-forwarded-for", "5.5.5.5");
    prismaMock.anonymousRequest.findUnique
      .mockResolvedValueOnce({ count: ANON_LIMIT, firstAt: expiredFirstAt() })
      .mockResolvedValueOnce({ firstAt: expiredFirstAt() });
    prismaMock.anonymousRequest.upsert.mockResolvedValueOnce({});

    const result = await gateAnonymousRequest();
    expect(result.ok).toBe(true);
    expect(prismaMock.anonymousRequest.upsert).toHaveBeenCalledOnce();
    const args = prismaMock.anonymousRequest.upsert.mock.calls[0]![0];
    expect(args.update.count).toBe(1);
  });
});
