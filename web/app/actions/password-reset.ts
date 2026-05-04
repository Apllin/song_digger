"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { generateResetToken } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/email";

const ForgotSchema = z.object({ email: z.string().email().toLowerCase() });

type ForgotResult = { success: true } | { error: string };

export async function forgotPasswordAction(
  formData: FormData,
): Promise<ForgotResult> {
  const parsed = ForgotSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Invalid email" };

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  // Always succeed — don't reveal whether the email is registered.
  if (!user || !user.passwordHash) return { success: true };

  // Rate limit: 1 reset request per minute. Silent success again so
  // an attacker can't probe rate limit state.
  const recent = await prisma.passwordResetToken.findFirst({
    where: { email, createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
  });
  if (recent) return { success: true };

  const token = generateResetToken();

  // Send email first — same pattern as register/resend. If Resend
  // fails, no token row left dangling. Failure surfaces as silent
  // success (still no enum).
  try {
    await sendPasswordResetEmail(email, token);
  } catch (err) {
    console.error("[forgot-password] email send failed:", err);
    return { success: true };
  }

  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h
  await prisma.passwordResetToken.deleteMany({ where: { email } });
  await prisma.passwordResetToken.create({
    data: { email, token, expires },
  });

  return { success: true };
}

const ResetSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8).max(128),
});

type ResetResult = { success: true } | { error: string };

export async function resetPasswordAction(
  formData: FormData,
): Promise<ResetResult> {
  const parsed = ResetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Invalid token or password" };

  const { token, password } = parsed.data;
  const reset = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  if (!reset || reset.expires < new Date()) {
    return {
      error: "Reset link invalid or expired. Request a new one.",
    };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { email: reset.email },
    data: { passwordHash },
  });
  // Invalidate every reset token for this email so a leaked link
  // becomes useless after one use.
  await prisma.passwordResetToken.deleteMany({
    where: { email: reset.email },
  });

  return { success: true };
}
