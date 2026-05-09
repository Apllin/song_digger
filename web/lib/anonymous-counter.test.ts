import { beforeEach, describe, expect, it, vi } from "vitest";

const headerStore = new Map<string, string>();
const prismaMock = {
  anonymousRequest: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => headerStore.get(key.toLowerCase()) ?? null,
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { ANON_LIMIT, getRequestIp, checkAnonymousLimit, incrementAnonymousCounter, gateAnonymousRequest } =
  await import("./anonymous-counter");

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
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({ count: 3 });
    const result = await checkAnonymousLimit("1.2.3.4");
    expect(result).toEqual({ overLimit: false, count: 3, remaining: ANON_LIMIT - 3 });
  });

  it("flags overLimit at exactly ANON_LIMIT", async () => {
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({
      count: ANON_LIMIT,
    });
    const result = await checkAnonymousLimit("1.2.3.4");
    expect(result.overLimit).toBe(true);
    expect(result.remaining).toBe(0);
  });
});

describe("incrementAnonymousCounter", () => {
  it("upserts with increment+lastAt update and count:1 create", async () => {
    prismaMock.anonymousRequest.upsert.mockResolvedValueOnce({});
    await incrementAnonymousCounter("9.9.9.9");
    expect(prismaMock.anonymousRequest.upsert).toHaveBeenCalledOnce();
    const args = prismaMock.anonymousRequest.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ ip: "9.9.9.9" });
    expect(args.create).toEqual({ ip: "9.9.9.9", count: 1 });
    expect(args.update.count).toEqual({ increment: 1 });
    expect(args.update.lastAt).toBeInstanceOf(Date);
  });
});

describe("gateAnonymousRequest", () => {
  it("returns ok and increments when under limit", async () => {
    headerStore.set("x-forwarded-for", "5.5.5.5");
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({ count: ANON_LIMIT - 1 });
    prismaMock.anonymousRequest.upsert.mockResolvedValueOnce({});

    const result = await gateAnonymousRequest();
    expect(result.ok).toBe(true);
    expect(prismaMock.anonymousRequest.upsert).toHaveBeenCalledOnce();
  });

  it("returns not-ok and skips increment when at limit", async () => {
    headerStore.set("x-forwarded-for", "5.5.5.5");
    prismaMock.anonymousRequest.findUnique.mockResolvedValueOnce({
      count: ANON_LIMIT,
    });

    const result = await gateAnonymousRequest();
    expect(result.ok).toBe(false);
    expect(prismaMock.anonymousRequest.upsert).not.toHaveBeenCalled();
  });
});
