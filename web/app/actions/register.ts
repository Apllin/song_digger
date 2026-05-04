"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode, hashCode } from "@/lib/auth-tokens";
import { sendVerificationCode } from "@/lib/email";

const RegisterSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
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
  });

  if (!parsed.success) {
    return { error: "Invalid email or password format" };
  }

  const { email, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && existing.passwordHash) {
    return { error: "Email already registered" };
  }

  const passwordHash = await bcrypt.hash(password, 10);

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

  const code = generateVerificationCode();
  const codeHash = await hashCode(code);
  const expires = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.verificationCode.deleteMany({ where: { email } });
  await prisma.verificationCode.create({
    data: { email, code: codeHash, expires },
  });

  await sendVerificationCode(email, code);

  return { success: true, email };
}
