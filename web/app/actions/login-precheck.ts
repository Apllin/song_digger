"use server";

import { z } from "zod";
import { shouldRequireCaptcha } from "@/lib/brute-force";

const Schema = z.object({
  email: z.string().email().toLowerCase(),
});

// Tells the login form whether to render the CAPTCHA before submit.
// Counts existing-email failures the same as nonexistent-email
// failures (the brute-force layer doesn't disambiguate), so the
// answer cannot be used to enumerate accounts. Returns false on
// invalid email format — no probing for "is this email format
// counted as a failure".
export async function loginPrecheckAction(
  email: string,
): Promise<{ requireCaptcha: boolean }> {
  const parsed = Schema.safeParse({ email });
  if (!parsed.success) return { requireCaptcha: false };
  const requireCaptcha = await shouldRequireCaptcha(parsed.data.email);
  return { requireCaptcha };
}
