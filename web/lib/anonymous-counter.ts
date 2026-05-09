import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";

export const ANON_LIMIT = 5;

// Reads x-forwarded-for / x-real-ip set by Vercel / nginx / Cloudflare.
// In bare local dev there is no proxy, so we fall back to "unknown" — a
// single shared bucket. That's only acceptable on localhost; ADR-0021
// flags this as a deployment requirement.
export async function getRequestIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export async function checkAnonymousLimit(ip: string): Promise<{
  overLimit: boolean;
  count: number;
  remaining: number;
}> {
  const row = await prisma.anonymousRequest.findUnique({
    where: { ip },
    select: { count: true },
  });
  const count = row?.count ?? 0;
  return {
    overLimit: count >= ANON_LIMIT,
    count,
    remaining: Math.max(0, ANON_LIMIT - count),
  };
}

export async function incrementAnonymousCounter(ip: string): Promise<void> {
  await prisma.anonymousRequest.upsert({
    where: { ip },
    create: { ip, count: 1 },
    update: { count: { increment: 1 }, lastAt: new Date() },
  });
}

// Combined helper — used by API routes that gate anonymous access.
// Returns { ok: false } when over the limit; the caller should respond
// 429 ANONYMOUS_LIMIT_REACHED. When ok, the counter has been incremented
// and the caller should proceed.
export async function gateAnonymousRequest(): Promise<{ ok: true } | { ok: false }> {
  const ip = await getRequestIp();
  const { overLimit } = await checkAnonymousLimit(ip);
  if (overLimit) return { ok: false };
  await incrementAnonymousCounter(ip);
  return { ok: true };
}
