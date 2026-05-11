import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { z } from "zod";

import { getRequestIp } from "@/lib/anonymous-counter";
import { generateResetToken, generateVerificationCode, hashCode, verifyCode } from "@/lib/auth-tokens";
import { checkIpRateLimit, shouldRequireCaptcha } from "@/lib/brute-force";
import { sendPasswordResetEmail, sendVerificationCode } from "@/lib/email";
import { HttpError } from "@/lib/hono/httpError";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";
import { verifyTurnstileToken } from "@/lib/turnstile";

const RegisterSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(8).max(128),
  turnstileToken: z.string().optional(),
  website: z.string().optional(),
});

const VerifyEmailSchema = z.object({
  email: z.email().toLowerCase(),
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
});

const ResendSchema = z.object({
  email: z.email().toLowerCase(),
});

const ForgotPasswordSchema = z.object({
  email: z.email().toLowerCase(),
});

const ResetPasswordSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8).max(128),
});

const LoginPrecheckSchema = z.object({
  email: z.email().toLowerCase(),
});

// Mounted under /account/* (not /auth/*) because Next.js's
// /api/auth/[...nextauth]/route.ts is a more specific match than the
// Hono catch-all /api/[[...route]]/route.ts, so any request to
// /api/auth/<x> would be handed to NextAuth and fail with
// `UnknownAction: Cannot parse action at /api/auth/<x>`.
export const authApi = new Hono<AppEnv>()
  .post("/account/register", zValidator("json", RegisterSchema), async (c) => {
    const data = c.req.valid("json");

    // Honeypot: non-empty means bot. Return fake success so the bot
    // sees no signal it was detected.
    if (data.website && data.website.length > 0) {
      return c.json({ success: true as const, email: data.email });
    }

    const { email, password, turnstileToken } = data;

    if (process.env.TURNSTILE_SECRET_KEY) {
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const ok = await verifyTurnstileToken(turnstileToken, {
        remoteIp: ip === "unknown" ? undefined : ip,
      });
      if (!ok) {
        return c.json({ error: "CAPTCHA verification failed. Please try again." });
      }
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing && existing.passwordHash) {
      return c.json({ error: "Email already registered" });
    }

    const code = generateVerificationCode();
    try {
      await sendVerificationCode(email, code);
    } catch (err) {
      console.error("[register] email send failed:", err);
      return c.json({ error: "We couldn't send your verification email. Please try again." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const codeHash = await hashCode(code);
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    if (existing) {
      await prisma.user.update({ where: { email }, data: { passwordHash } });
    } else {
      await prisma.user.create({ data: { email, passwordHash, emailVerified: null } });
    }

    await prisma.verificationCode.deleteMany({ where: { email } });
    await prisma.verificationCode.create({ data: { email, code: codeHash, expires } });

    return c.json({ success: true as const, email });
  })
  .post("/account/verify-email", zValidator("json", VerifyEmailSchema), async (c) => {
    const { email, code } = c.req.valid("json");

    const pendingCodes = await prisma.verificationCode.findMany({
      where: { email, expires: { gt: new Date() } },
    });

    if (pendingCodes.length === 0) {
      return c.json({ error: "Code expired or not found. Please request a new one." });
    }

    let matched = false;
    for (const pending of pendingCodes) {
      if (await verifyCode(code, pending.code)) {
        matched = true;
        break;
      }
    }

    if (!matched) return c.json({ error: "Invalid code" });

    await prisma.user.update({ where: { email }, data: { emailVerified: new Date() } });
    await prisma.verificationCode.deleteMany({ where: { email } });

    return c.json({ success: true as const });
  })
  .post("/account/resend-verification", zValidator("json", ResendSchema), async (c) => {
    const { email } = c.req.valid("json");

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) return c.json({ success: true as const });

    if (user.emailVerified) return c.json({ error: "Email already verified" });

    const recent = await prisma.verificationCode.findFirst({
      where: { email, createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
    });
    if (recent) {
      return c.json({ error: "Please wait a minute before requesting another code" });
    }

    const code = generateVerificationCode();
    try {
      await sendVerificationCode(email, code);
    } catch (err) {
      console.error("[resend] email send failed:", err);
      return c.json({ error: "We couldn't send the email. Please try again." });
    }

    const codeHash = await hashCode(code);
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.verificationCode.deleteMany({ where: { email } });
    await prisma.verificationCode.create({ data: { email, code: codeHash, expires } });

    return c.json({ success: true as const });
  })
  .post("/account/forgot-password", zValidator("json", ForgotPasswordSchema), async (c) => {
    const { email } = c.req.valid("json");

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) return c.json({ success: true as const });

    const recent = await prisma.passwordResetToken.findFirst({
      where: { email, createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
    });
    if (recent) return c.json({ success: true as const });

    const token = generateResetToken();
    try {
      await sendPasswordResetEmail(email, token);
    } catch (err) {
      console.error("[forgot-password] email send failed:", err);
      return c.json({ success: true as const });
    }

    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.passwordResetToken.deleteMany({ where: { email } });
    await prisma.passwordResetToken.create({ data: { email, token, expires } });

    return c.json({ success: true as const });
  })
  .post("/account/reset-password", zValidator("json", ResetPasswordSchema), async (c) => {
    const { token, password } = c.req.valid("json");

    const reset = await prisma.passwordResetToken.findUnique({ where: { token } });

    if (!reset || reset.expires < new Date()) {
      return c.json({ error: "Reset link invalid or expired. Request a new one." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { email: reset.email }, data: { passwordHash } });
    await prisma.passwordResetToken.deleteMany({ where: { email: reset.email } });

    return c.json({ success: true as const });
  })
  .post("/account/login-precheck", zValidator("json", LoginPrecheckSchema), async (c) => {
    const { email } = c.req.valid("json");
    const ip = await getRequestIp();
    const { blocked } = await checkIpRateLimit(ip);
    if (blocked)
      throw new HttpError(429, {
        name: "RATE_LIMIT_REACHED",
        message: "Too many login attempts. Please try again later.",
      });
    const requireCaptcha = await shouldRequireCaptcha(email);
    return c.json({ requireCaptcha });
  });
