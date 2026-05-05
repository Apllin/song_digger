"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode, hashCode } from "@/lib/auth-tokens";
import { sendVerificationCode } from "@/lib/email";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { getRequestIp } from "@/lib/anonymous-counter";

const RegisterSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  // Optional in the schema so dev environments without
  // NEXT_PUBLIC_TURNSTILE_SITE_KEY can still register. The action body
  // enforces presence whenever the secret is configured.
  turnstileToken: z.string().optional(),
});

type RegisterResult =
  | { success: true; email: string }
  | { error: string };

export async function registerAction(
  formData: FormData,
): Promise<RegisterResult> {
  const parsed = RegisterSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    turnstileToken: formData.get("turnstileToken") ?? undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid email or password format" };
  }

  const { email, password, turnstileToken } = parsed.data;

  // CAPTCHA gate — runs before the existence check, the password
  // hash, the email send, and any DB writes. Skipped only when the
  // server is not configured for Turnstile (TURNSTILE_SECRET_KEY
  // unset). Production deployment requires the secret.
  if (process.env.TURNSTILE_SECRET_KEY) {
    const ip = await getRequestIp();
    const ok = await verifyTurnstileToken(turnstileToken, {
      remoteIp: ip === "unknown" ? undefined : ip,
    });
    if (!ok) {
      return { error: "CAPTCHA verification failed. Please try again." };
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && existing.passwordHash) {
    return { error: "Email already registered" };
  }

  // Send email BEFORE writing to DB. Resend can fail (free-tier
  // sandbox, unverified domain, invalid key) — if we'd already
  // claimed the admin row or created a fresh user, the next register
  // attempt would hit "already registered" with no code to verify.
  // Send-first means failure leaves the DB untouched and the user
  // can simply retry.
  const code = generateVerificationCode();
  try {
    await sendVerificationCode(email, code);
  } catch (err) {
    console.error("[register] email send failed:", err);
    return {
      error: "We couldn't send your verification email. Please try again.",
    };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const codeHash = await hashCode(code);
  const expires = new Date(Date.now() + 15 * 60 * 1000);

  if (existing) {
    // Pre-existing admin row (passwordHash null) — claim it. Stage I,
    // migration 20260504215611 created exactly one such row.
    await prisma.user.update({
      where: { email },
      data: { passwordHash },
    });
  } else {
    await prisma.user.create({
      data: { email, passwordHash, emailVerified: null },
    });
  }

  await prisma.verificationCode.deleteMany({ where: { email } });
  await prisma.verificationCode.create({
    data: { email, code: codeHash, expires },
  });

  return { success: true, email };
}
