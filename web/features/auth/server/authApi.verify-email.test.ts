import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  verificationCode: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
};

const sendVerificationCode = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/email", () => ({ sendVerificationCode }));

const { authApi } = await import("./authApi");

async function postVerify(body: Record<string, unknown>): Promise<Response> {
  return authApi.request("/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postResend(body: Record<string, unknown>): Promise<Response> {
  return authApi.request("/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/verify-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for malformed code", async () => {
    const res = await postVerify({ email: "user@example.com", code: "abc" });
    expect(res.status).toBe(400);
    expect(prismaMock.verificationCode.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 for 5-digit code", async () => {
    const res = await postVerify({ email: "user@example.com", code: "12345" });
    expect(res.status).toBe(400);
  });

  it("rejects when no pending codes exist (expired or never created)", async () => {
    prismaMock.verificationCode.findMany.mockResolvedValueOnce([]);
    const res = await postVerify({ email: "user@example.com", code: "123456" });
    const result = await res.json();
    expect(result).toEqual({
      error: "Code expired or not found. Please request a new one.",
    });
  });

  it("rejects when code does not match any pending hash", async () => {
    const wrongHash = await bcrypt.hash("999999", 10);
    prismaMock.verificationCode.findMany.mockResolvedValueOnce([
      { code: wrongHash, expires: new Date(Date.now() + 60_000) },
    ]);
    const res = await postVerify({ email: "user@example.com", code: "123456" });
    const result = await res.json();
    expect(result).toEqual({ error: "Invalid code" });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("marks user verified and deletes codes on match", async () => {
    const validHash = await bcrypt.hash("123456", 10);
    prismaMock.verificationCode.findMany.mockResolvedValueOnce([
      { code: validHash, expires: new Date(Date.now() + 60_000) },
    ]);
    prismaMock.user.update.mockResolvedValueOnce({});
    prismaMock.verificationCode.deleteMany.mockResolvedValueOnce({ count: 1 });

    const res = await postVerify({ email: "user@example.com", code: "123456" });
    const result = await res.json();
    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      data: { emailVerified: expect.any(Date) },
    });
    expect(prismaMock.verificationCode.deleteMany).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
    });
  });

  it("matches against any pending code (resend race)", async () => {
    const oldHash = await bcrypt.hash("111111", 10);
    const newHash = await bcrypt.hash("222222", 10);
    prismaMock.verificationCode.findMany.mockResolvedValueOnce([
      { code: oldHash, expires: new Date(Date.now() + 60_000) },
      { code: newHash, expires: new Date(Date.now() + 60_000) },
    ]);
    prismaMock.user.update.mockResolvedValueOnce({});
    prismaMock.verificationCode.deleteMany.mockResolvedValueOnce({ count: 2 });

    const res = await postVerify({ email: "user@example.com", code: "111111" });
    const result = await res.json();
    expect(result).toEqual({ success: true });
  });

  it("filters expired codes via Prisma where clause", async () => {
    prismaMock.verificationCode.findMany.mockResolvedValueOnce([]);
    await postVerify({ email: "user@example.com", code: "123456" });
    const call = prismaMock.verificationCode.findMany.mock.calls[0]![0];
    expect(call.where.email).toBe("user@example.com");
    expect(call.where.expires).toEqual({ gt: expect.any(Date) });
  });
});

describe("POST /auth/resend-verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success silently for nonexistent user (no enumeration)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const res = await postResend({ email: "nobody@example.com" });
    const result = await res.json();
    expect(result).toEqual({ success: true });
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("rejects when user is already verified", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      email: "verified@example.com",
      emailVerified: new Date(),
    });
    const res = await postResend({ email: "verified@example.com" });
    const result = await res.json();
    expect(result).toEqual({ error: "Email already verified" });
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("rejects when a code was created in the last minute", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      emailVerified: null,
    });
    prismaMock.verificationCode.findFirst.mockResolvedValueOnce({
      createdAt: new Date(Date.now() - 30 * 1000),
    });
    const res = await postResend({ email: "user@example.com" });
    const result = await res.json();
    expect(result).toEqual({
      error: "Please wait a minute before requesting another code",
    });
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("sends new code if last was over a minute ago", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      emailVerified: null,
    });
    prismaMock.verificationCode.findFirst.mockResolvedValueOnce(null);
    sendVerificationCode.mockResolvedValueOnce(undefined);
    prismaMock.verificationCode.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.verificationCode.create.mockResolvedValueOnce({});

    const res = await postResend({ email: "user@example.com" });
    const result = await res.json();
    expect(result).toEqual({ success: true });

    const [emailArg, codeArg] = sendVerificationCode.mock.calls[0]!;
    expect(emailArg).toBe("user@example.com");
    expect(codeArg).toMatch(/^\d{6}$/);

    const stored = prismaMock.verificationCode.create.mock.calls[0]![0].data;
    expect(stored.code).toMatch(/^\$2[aby]\$/);
    expect(stored.code).not.toMatch(/^\d{6}$/);
  });

  it("does not write to DB if email send fails", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      emailVerified: null,
    });
    prismaMock.verificationCode.findFirst.mockResolvedValueOnce(null);
    sendVerificationCode.mockRejectedValueOnce(new Error("Resend down"));

    const res = await postResend({ email: "user@example.com" });
    const result = await res.json();
    expect(result).toEqual({
      error: "We couldn't send the email. Please try again.",
    });
    expect(prismaMock.verificationCode.create).not.toHaveBeenCalled();
  });
});
