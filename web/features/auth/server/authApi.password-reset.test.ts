import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  passwordResetToken: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
};

const sendPasswordResetEmail = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/email", () => ({ sendPasswordResetEmail }));

const { authApi } = await import("./authApi");

async function postForgot(body: Record<string, unknown>): Promise<Response> {
  return authApi.request("/account/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postReset(body: Record<string, unknown>): Promise<Response> {
  return authApi.request("/account/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /account/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for malformed email", async () => {
    const res = await postForgot({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns success silently for nonexistent user (no enumeration)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const res = await postForgot({ email: "nobody@example.com" });
    const result = await res.json();
    expect(result).toEqual({ success: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("returns success silently for user without passwordHash (admin pre-claim)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      email: "admin@example.com",
      passwordHash: null,
    });
    const res = await postForgot({ email: "admin@example.com" });
    const result = await res.json();
    expect(result).toEqual({ success: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("silently succeeds when a token was created in the last minute (rate limit)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      passwordHash: "$2a$10$...",
    });
    prismaMock.passwordResetToken.findFirst.mockResolvedValueOnce({
      createdAt: new Date(Date.now() - 30 * 1000),
    });
    const res = await postForgot({ email: "user@example.com" });
    const result = await res.json();
    expect(result).toEqual({ success: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("creates token + sends email for valid request", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      passwordHash: "$2a$10$...",
    });
    prismaMock.passwordResetToken.findFirst.mockResolvedValueOnce(null);
    sendPasswordResetEmail.mockResolvedValueOnce(undefined);
    prismaMock.passwordResetToken.deleteMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.passwordResetToken.create.mockResolvedValueOnce({});

    const res = await postForgot({ email: "user@example.com" });
    const result = await res.json();
    expect(result).toEqual({ success: true });

    const [emailArg, tokenArg] = sendPasswordResetEmail.mock.calls[0]!;
    expect(emailArg).toBe("user@example.com");
    expect(tokenArg).toMatch(/^[0-9a-f]{64}$/);

    const stored = prismaMock.passwordResetToken.create.mock.calls[0]![0].data;
    expect(stored.email).toBe("user@example.com");
    expect(stored.token).toBe(tokenArg);
    const ttl = stored.expires.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("does not write a token if email send fails", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      passwordHash: "$2a$10$...",
    });
    prismaMock.passwordResetToken.findFirst.mockResolvedValueOnce(null);
    sendPasswordResetEmail.mockRejectedValueOnce(new Error("Resend down"));

    const res = await postForgot({ email: "user@example.com" });
    const result = await res.json();
    expect(result).toEqual({ success: true });
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
  });
});

describe("POST /account/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for short password", async () => {
    const res = await postReset({ token: "a".repeat(64), password: "short" });
    expect(res.status).toBe(400);
    expect(prismaMock.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 for short token", async () => {
    const res = await postReset({ token: "a".repeat(8), password: "validpassword" });
    expect(res.status).toBe(400);
  });

  it("rejects nonexistent token", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValueOnce(null);
    const res = await postReset({ token: "a".repeat(64), password: "validpassword" });
    const result = await res.json();
    expect(result).toEqual({
      error: "Reset link invalid or expired. Request a new one.",
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects expired token", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      token: "a".repeat(64),
      expires: new Date(Date.now() - 60 * 1000),
    });
    const res = await postReset({ token: "a".repeat(64), password: "validpassword" });
    const result = await res.json();
    expect(result).toEqual({
      error: "Reset link invalid or expired. Request a new one.",
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("updates passwordHash and deletes all tokens for the email on success", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValueOnce({
      email: "user@example.com",
      token: "a".repeat(64),
      expires: new Date(Date.now() + 30 * 60 * 1000),
    });
    prismaMock.user.update.mockResolvedValueOnce({});
    prismaMock.passwordResetToken.deleteMany.mockResolvedValueOnce({ count: 1 });

    const res = await postReset({ token: "a".repeat(64), password: "validpassword" });
    const result = await res.json();
    expect(result).toEqual({ success: true });

    expect(prismaMock.user.update).toHaveBeenCalledOnce();
    const updateCall = prismaMock.user.update.mock.calls[0]![0];
    expect(updateCall.where).toEqual({ email: "user@example.com" });
    expect(updateCall.data.passwordHash).toMatch(/^\$2[aby]\$/);

    expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
    });
  });
});
