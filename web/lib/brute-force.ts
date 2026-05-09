import { prisma } from "@/lib/prisma";

// Per-IP cap: 10 failed login attempts in any 15-minute window
// returns 429. Successes don't tick the counter — a working user
// hammering the form by accident never gets locked out.
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_ATTEMPTS = 10;

// Per-email exponential backoff. Index is failed-attempt count for
// THIS email in the lookback window; value is the delay applied
// before authorize() returns. Caps at 64s on the 5th and beyond —
// the spec's longest hold. (Vercel free tier function timeout is
// 10s, so production deploys must bump the auth route timeout to
// 90s+ — flagged in ADR-0021 pitfalls.)
const EMAIL_BACKOFF_MS = [0, 0, 1_000, 4_000, 16_000, 64_000];

const EMAIL_LOOKBACK_MS = 60 * 60 * 1000; // 1 hour
const CAPTCHA_THRESHOLD = 3;
const NOTIFY_THRESHOLD = 5;

export const BRUTE_FORCE_CONSTANTS = {
  IP_WINDOW_MS,
  IP_MAX_ATTEMPTS,
  EMAIL_BACKOFF_MS,
  EMAIL_LOOKBACK_MS,
  CAPTCHA_THRESHOLD,
  NOTIFY_THRESHOLD,
};

export async function checkIpRateLimit(ip: string): Promise<{ blocked: boolean; attemptsInWindow: number }> {
  const since = new Date(Date.now() - IP_WINDOW_MS);
  const attemptsInWindow = await prisma.loginAttempt.count({
    where: { ip, success: false, createdAt: { gte: since } },
  });
  return { blocked: attemptsInWindow >= IP_MAX_ATTEMPTS, attemptsInWindow };
}

export async function getEmailFailedCount(email: string): Promise<number> {
  const since = new Date(Date.now() - EMAIL_LOOKBACK_MS);
  return prisma.loginAttempt.count({
    where: { email, success: false, createdAt: { gte: since } },
  });
}

export function getBackoffDelayMs(failedCount: number): number {
  if (failedCount <= 0) return 0;
  const idx = Math.min(failedCount, EMAIL_BACKOFF_MS.length - 1);
  return EMAIL_BACKOFF_MS[idx];
}

export async function shouldRequireCaptcha(email: string): Promise<boolean> {
  if (!email) return false;
  const failed = await getEmailFailedCount(email);
  return failed >= CAPTCHA_THRESHOLD;
}

// Returns true exactly when the failed-count crossing is happening
// THIS attempt (i.e., the current attempt is the NOTIFY_THRESHOLD-th
// failure). Caller is responsible for sending the email — the
// helper returns a boolean so the test surface is pure.
export function shouldNotifyOnThisFailure(prevFailedCount: number): boolean {
  return prevFailedCount + 1 === NOTIFY_THRESHOLD;
}

export async function recordLoginAttempt(ip: string, email: string | null, success: boolean): Promise<void> {
  await prisma.loginAttempt.create({
    data: { ip, email, success },
  });
}

export async function clearFailedAttempts(email: string): Promise<void> {
  // On successful login, drop this email's failed history so the
  // user doesn't keep paying backoff. Other emails on the same IP
  // and the IP-level rate limit are unaffected — the per-IP cap is
  // independent and counts ALL failures regardless of which email
  // they targeted.
  await prisma.loginAttempt.deleteMany({
    where: { email, success: false },
  });
}
