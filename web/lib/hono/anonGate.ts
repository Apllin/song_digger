import type { MiddlewareHandler } from "hono";

import { gateAnonymousRequest } from "@/lib/anonymous-counter";
import { auth } from "@/lib/auth";

// Per ADR-0021: anonymous users get 10 free requests pooled across the
// search-entry routes. Authenticated users bypass. Mount on Hono routes that
// are typed-search entry points (artist search, label search, /search) — not
// on follow-up calls (releases, tracklist, embed).
export const anonGate: MiddlewareHandler = async (c, next) => {
  const session = await auth();
  if (!session?.user) {
    const gate = await gateAnonymousRequest();
    if (!gate.ok) {
      return c.json({ error: "ANONYMOUS_LIMIT_REACHED" as const }, 429);
    }
  }
  await next();
};
