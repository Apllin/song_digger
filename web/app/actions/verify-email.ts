"use server";

import { z } from "zod";

import { generateVerificationCode, hashCode, verifyCode } from "@/lib/auth-tokens";
import { sendVerificationCode } from "@/lib/email";
import { prisma } from "@/lib/prisma";

const VerifySchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
});

type VerifyResult = { success: true } | { error: string };

export async function verifyEmailAction(formData: FormData): Promise<VerifyResult> {
  const parsed = VerifySchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
  });

  if (!parsed.success) return { error: "Invalid email or code format" };

  const { email, code } = parsed.data;

  const pendingCodes = await prisma.verificationCode.findMany({
    where: { email, expires: { gt: new Date() } },
  });

  if (pendingCodes.length === 0) {
    return { error: "Code expired or not found. Please request a new one." };
  }

  // Compare against every non-expired hash. A user might have multiple
  // pending codes from a quick resend; either should work.
  let matched = false;
  for (const pending of pendingCodes) {
    if (await verifyCode(code, pending.code)) {
      matched = true;
      break;
    }
  }

  if (!matched) return { error: "Invalid code" };

  await prisma.user.update({
    where: { email },
    data: { emailVerified: new Date() },
  });
  await prisma.verificationCode.deleteMany({ where: { email } });

  return { success: true };
}

const ResendSchema = z.object({ email: z.string().email().toLowerCase() });

type ResendResult = { success: true } | { error: string };

export async function resendVerificationCodeAction(formData: FormData): Promise<ResendResult> {
  const parsed = ResendSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Invalid email" };

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  // Don't reveal nonexistent users — return success silently.
  if (!user) return { success: true };

  // Already verified is actionable info ("just sign in"), so we surface it.
  if (user.emailVerified) return { error: "Email already verified" };

  const recent = await prisma.verificationCode.findFirst({
    where: { email, createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
  });
  if (recent) {
    return {
      error: "Please wait a minute before requesting another code",
    };
  }

  // Generate + try to send first; if Resend fails, don't churn the DB.
  const code = generateVerificationCode();
  try {
    await sendVerificationCode(email, code);
  } catch (err) {
    console.error("[resend] email send failed:", err);
    return { error: "We couldn't send the email. Please try again." };
  }

  const codeHash = await hashCode(code);
  const expires = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.verificationCode.deleteMany({ where: { email } });
  await prisma.verificationCode.create({
    data: { email, code: codeHash, expires },
  });

  return { success: true };
}
