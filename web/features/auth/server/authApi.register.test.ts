import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  verificationCode: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
};

const sendVerificationCode = vi.fn();
const verifyTurnstileToken = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/email", () => ({ sendVerificationCode }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken }));

delete process.env.TURNSTILE_SECRET_KEY;

const { authApi } = await import("./authApi");

async function post(body: Record<string, unknown>): Promise<Response> {
  return authApi.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid email", async () => {
    const res = await post({ email: "not-an-email", password: "longenough" });
    expect(res.status).toBe(400);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 for short password", async () => {
    const res = await post({ email: "user@example.com", password: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects email already registered (existing passwordHash)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      email: "taken@example.com",
      passwordHash: "$2a$10$...",
      emailVerified: new Date(),
    });
    const res = await post({ email: "taken@example.com", password: "validpassword" });
    const result = await res.json();
    expect(result).toEqual({ error: "Email already registered" });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("creates new user and sends code on first registration", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({ id: "new" });
    prismaMock.verificationCode.deleteMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.verificationCode.create.mockResolvedValueOnce({});
    sendVerificationCode.mockResolvedValueOnce(undefined);

    const res = await post({ email: "fresh@example.com", password: "validpassword" });
    const result = await res.json();
    expect(result).toEqual({ success: true, email: "fresh@example.com" });

    expect(prismaMock.user.create).toHaveBeenCalledOnce();
    const created = prismaMock.user.create.mock.calls[0]![0].data;
    expect(created.email).toBe("fresh@example.com");
    expect(created.emailVerified).toBeNull();
    expect(created.passwordHash).toMatch(/^\$2[aby]\$/);

    expect(sendVerificationCode).toHaveBeenCalledOnce();
    const [emailArg, codeArg] = sendVerificationCode.mock.calls[0]!;
    expect(emailArg).toBe("fresh@example.com");
    expect(codeArg).toMatch(/^\d{6}$/);
  });

  it("claims pre-existing admin row (passwordHash null) instead of creating", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "admin_seed_account_id",
      email: "daebatzaebis@gmail.com",
      passwordHash: null,
      emailVerified: null,
    });
    prismaMock.user.update.mockResolvedValueOnce({});
    prismaMock.verificationCode.deleteMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.verificationCode.create.mockResolvedValueOnce({});
    sendVerificationCode.mockResolvedValueOnce(undefined);

    const res = await post({ email: "daebatzaebis@gmail.com", password: "validpassword" });
    const result = await res.json();
    expect(result).toEqual({ success: true, email: "daebatzaebis@gmail.com" });

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledOnce();
    expect(prismaMock.user.update.mock.calls[0]![0].where).toEqual({
      email: "daebatzaebis@gmail.com",
    });
    expect(prismaMock.user.update.mock.calls[0]![0].data.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("normalizes email to lowercase before lookup and storage", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({});
    prismaMock.verificationCode.deleteMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.verificationCode.create.mockResolvedValueOnce({});
    sendVerificationCode.mockResolvedValueOnce(undefined);

    await post({ email: "Mixed@Example.COM", password: "validpassword" });

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: "mixed@example.com" },
    });
    expect(prismaMock.user.create.mock.calls[0]![0].data.email).toBe("mixed@example.com");
  });

  it("does not write to DB if email send fails", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    sendVerificationCode.mockRejectedValueOnce(new Error("Resend send failed (validation_error): bad sandbox"));

    const res = await post({ email: "x@example.com", password: "validpassword" });
    const result = await res.json();
    expect(result).toEqual({
      error: "We couldn't send your verification email. Please try again.",
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.verificationCode.create).not.toHaveBeenCalled();
  });

  describe("honeypot", () => {
    it("returns fake success and writes nothing when 'website' is filled", async () => {
      const res = await post({
        email: "bot@example.com",
        password: "validpassword",
        website: "https://spam.example",
      });
      const result = await res.json();
      expect(result).toEqual({ success: true, email: "bot@example.com" });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe("CAPTCHA gate", () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
    });

    afterEach(() => {
      delete process.env.TURNSTILE_SECRET_KEY;
    });

    it("rejects when Turnstile verification fails", async () => {
      verifyTurnstileToken.mockResolvedValueOnce(false);
      const res = await post({
        email: "user@example.com",
        password: "validpassword",
        turnstileToken: "bad",
      });
      const result = await res.json();
      expect(result).toEqual({
        error: "CAPTCHA verification failed. Please try again.",
      });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(sendVerificationCode).not.toHaveBeenCalled();
    });

    it("proceeds when Turnstile verification passes", async () => {
      verifyTurnstileToken.mockResolvedValueOnce(true);
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValueOnce({});
      prismaMock.verificationCode.deleteMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.verificationCode.create.mockResolvedValueOnce({});
      sendVerificationCode.mockResolvedValueOnce(undefined);

      const res = await post({
        email: "user@example.com",
        password: "validpassword",
        turnstileToken: "good",
      });
      const result = await res.json();
      expect(result).toEqual({ success: true, email: "user@example.com" });
      expect(verifyTurnstileToken).toHaveBeenCalledWith("good", expect.any(Object));
    });

    it("fails CAPTCHA gate before checking existence (no enumeration)", async () => {
      verifyTurnstileToken.mockResolvedValueOnce(false);
      await post({
        email: "taken@example.com",
        password: "validpassword",
        turnstileToken: "bad",
      });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
  });

  it("hashes the verification code before storing", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValueOnce({});
    prismaMock.verificationCode.deleteMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.verificationCode.create.mockResolvedValueOnce({});
    sendVerificationCode.mockResolvedValueOnce(undefined);

    await post({ email: "user@example.com", password: "validpassword" });

    const stored = prismaMock.verificationCode.create.mock.calls[0]![0].data;
    expect(stored.code).toMatch(/^\$2[aby]\$/);
    expect(stored.code).not.toMatch(/^\d{6}$/);
    const ttl = stored.expires.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);
  });
});
