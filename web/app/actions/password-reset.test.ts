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

const { forgotPasswordAction, resetPasswordAction } = await import("./password-reset");

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("forgotPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed email", async () => {
    const result = await forgotPasswordAction(fd({ email: "not-an-email" }));
    expect(result).toEqual({ error: "Invalid email" });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns success silently for nonexistent user (no enumeration)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const result = await forgotPasswordAction(fd({ email: "nobody@example.com" }));
    expect(result).toEqual({ success: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("returns success silently for user without passwordHash (admin pre-claim)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      email: "admin@example.com",
      passwordHash: null,
    });
    const result = await forgotPasswordAction(fd({ email: "admin@example.com" }));
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
    const result = await forgotPasswordAction(fd({ email: "user@example.com" }));
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
    prismaMock.passwordResetToken.deleteMany.mockResolvedValueOnce({
      count: 0,
    });
    prismaMock.passwordResetToken.create.mockResolvedValueOnce({});

    const result = await forgotPasswordAction(fd({ email: "user@example.com" }));
    expect(result).toEqual({ success: true });

    const [emailArg, tokenArg] = sendPasswordResetEmail.mock.calls[0];
    expect(emailArg).toBe("user@example.com");
    expect(tokenArg).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex = 64 chars

    const stored = prismaMock.passwordResetToken.create.mock.calls[0][0].data;
    expect(stored.email).toBe("user@example.com");
    expect(stored.token).toBe(tokenArg);
    // 1-hour window
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

    const result = await forgotPasswordAction(fd({ email: "user@example.com" }));
    expect(result).toEqual({ success: true }); // still no enum
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
  });
});

describe("resetPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects short password", async () => {
    const result = await resetPasswordAction(fd({ token: "a".repeat(64), password: "short" }));
    expect(result).toEqual({ error: "Invalid token or password" });
    expect(prismaMock.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("rejects short token", async () => {
    const result = await resetPasswordAction(fd({ token: "a".repeat(8), password: "validpassword" }));
    expect(result).toEqual({ error: "Invalid token or password" });
  });

  it("rejects nonexistent token", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValueOnce(null);
    const result = await resetPasswordAction(fd({ token: "a".repeat(64), password: "validpassword" }));
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
    const result = await resetPasswordAction(fd({ token: "a".repeat(64), password: "validpassword" }));
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
    prismaMock.passwordResetToken.deleteMany.mockResolvedValueOnce({
      count: 1,
    });

    const result = await resetPasswordAction(fd({ token: "a".repeat(64), password: "validpassword" }));
    expect(result).toEqual({ success: true });

    expect(prismaMock.user.update).toHaveBeenCalledOnce();
    const updateCall = prismaMock.user.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ email: "user@example.com" });
    expect(updateCall.data.passwordHash).toMatch(/^\$2[aby]\$/);

    expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
    });
  });
});
