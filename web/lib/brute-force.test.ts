import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  loginAttempt: {
    count: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const {
  BRUTE_FORCE_CONSTANTS,
  checkIpRateLimit,
  getEmailFailedCount,
  getBackoffDelayMs,
  shouldRequireCaptcha,
  shouldNotifyOnThisFailure,
  recordLoginAttempt,
  clearFailedAttempts,
} = await import("./brute-force");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkIpRateLimit", () => {
  it("returns blocked=false when below cap", async () => {
    prismaMock.loginAttempt.count.mockResolvedValueOnce(3);
    const result = await checkIpRateLimit("1.2.3.4");
    expect(result).toEqual({ blocked: false, attemptsInWindow: 3 });
  });

  it("returns blocked=true at exactly the cap", async () => {
    prismaMock.loginAttempt.count.mockResolvedValueOnce(BRUTE_FORCE_CONSTANTS.IP_MAX_ATTEMPTS);
    const result = await checkIpRateLimit("1.2.3.4");
    expect(result.blocked).toBe(true);
  });

  it("only counts failed attempts inside the lookback window", async () => {
    prismaMock.loginAttempt.count.mockResolvedValueOnce(0);
    await checkIpRateLimit("9.9.9.9");
    const where = prismaMock.loginAttempt.count.mock.calls[0][0].where;
    expect(where.ip).toBe("9.9.9.9");
    expect(where.success).toBe(false);
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    const ageMs = Date.now() - where.createdAt.gte.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(BRUTE_FORCE_CONSTANTS.IP_WINDOW_MS - 50);
    expect(ageMs).toBeLessThanOrEqual(BRUTE_FORCE_CONSTANTS.IP_WINDOW_MS + 50);
  });
});

describe("getBackoffDelayMs", () => {
  it("is zero for the first attempt", () => {
    expect(getBackoffDelayMs(0)).toBe(0);
    expect(getBackoffDelayMs(1)).toBe(0);
  });

  it("escalates 1s -> 4s -> 16s -> 64s on attempts 2..5", () => {
    expect(getBackoffDelayMs(2)).toBe(1_000);
    expect(getBackoffDelayMs(3)).toBe(4_000);
    expect(getBackoffDelayMs(4)).toBe(16_000);
    expect(getBackoffDelayMs(5)).toBe(64_000);
  });

  it("clamps at the longest delay for very high counts", () => {
    expect(getBackoffDelayMs(50)).toBe(64_000);
  });
});

describe("shouldRequireCaptcha", () => {
  it("returns false on empty email without DB hit", async () => {
    expect(await shouldRequireCaptcha("")).toBe(false);
    expect(prismaMock.loginAttempt.count).not.toHaveBeenCalled();
  });

  it("requires CAPTCHA at exactly the threshold of failures", async () => {
    prismaMock.loginAttempt.count.mockResolvedValueOnce(BRUTE_FORCE_CONSTANTS.CAPTCHA_THRESHOLD);
    expect(await shouldRequireCaptcha("user@example.com")).toBe(true);
  });

  it("does not require CAPTCHA below the threshold", async () => {
    prismaMock.loginAttempt.count.mockResolvedValueOnce(BRUTE_FORCE_CONSTANTS.CAPTCHA_THRESHOLD - 1);
    expect(await shouldRequireCaptcha("user@example.com")).toBe(false);
  });
});

describe("shouldNotifyOnThisFailure", () => {
  it("triggers exactly when this failure crosses NOTIFY_THRESHOLD", () => {
    const t = BRUTE_FORCE_CONSTANTS.NOTIFY_THRESHOLD;
    expect(shouldNotifyOnThisFailure(t - 2)).toBe(false);
    expect(shouldNotifyOnThisFailure(t - 1)).toBe(true);
    // Already past the threshold -> don't spam
    expect(shouldNotifyOnThisFailure(t)).toBe(false);
    expect(shouldNotifyOnThisFailure(t + 5)).toBe(false);
  });
});

describe("recordLoginAttempt + clearFailedAttempts", () => {
  it("recordLoginAttempt stores ip/email/success", async () => {
    prismaMock.loginAttempt.create.mockResolvedValueOnce({});
    await recordLoginAttempt("1.1.1.1", "u@e.com", true);
    expect(prismaMock.loginAttempt.create).toHaveBeenCalledWith({
      data: { ip: "1.1.1.1", email: "u@e.com", success: true },
    });
  });

  it("clearFailedAttempts deletes only failed rows for the email", async () => {
    prismaMock.loginAttempt.deleteMany.mockResolvedValueOnce({ count: 4 });
    await clearFailedAttempts("u@e.com");
    expect(prismaMock.loginAttempt.deleteMany).toHaveBeenCalledWith({
      where: { email: "u@e.com", success: false },
    });
  });
});

describe("getEmailFailedCount", () => {
  it("queries failures for email inside the email lookback window", async () => {
    prismaMock.loginAttempt.count.mockResolvedValueOnce(2);
    const n = await getEmailFailedCount("u@e.com");
    expect(n).toBe(2);
    const where = prismaMock.loginAttempt.count.mock.calls[0][0].where;
    expect(where.email).toBe("u@e.com");
    expect(where.success).toBe(false);
    const ageMs = Date.now() - where.createdAt.gte.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(BRUTE_FORCE_CONSTANTS.EMAIL_LOOKBACK_MS - 50);
    expect(ageMs).toBeLessThanOrEqual(BRUTE_FORCE_CONSTANTS.EMAIL_LOOKBACK_MS + 50);
  });
});
