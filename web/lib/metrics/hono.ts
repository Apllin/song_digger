import type { MiddlewareHandler } from "hono";
import { createEmptyContext, metricsStorage } from "./context";
import { flushMetric } from "./flush";

import { auth } from "@/lib/auth";

// Top-level Hono middleware. Opens an AsyncLocalStorage context for the
// duration of the request so the Prisma extension can count DB calls, and
// flushes a RequestMetric row once the response is built.
//
// The auth() call resolves the session at request time so we can attribute
// the row to a userId. This is the same call routes already make — cached
// per request by Next's request memoization, so it doesn't add a second
// DB hit on the auth tables.
//
// The flush happens AFTER `metricsStorage.run(...)` returns so the
// insertRequestMetric query itself isn't counted against the context it's
// writing (the extension's getStore() will return undefined).
export const metricsMiddleware: MiddlewareHandler = async (c, next) => {
  const session = await auth().catch(() => null);
  const url = new URL(c.req.url);
  const ctx = createEmptyContext(url.pathname, c.req.method, session?.user?.id ?? null);

  const startTime = performance.now();
  const startCpu = process.cpuUsage();

  await metricsStorage.run(ctx, async () => {
    await next();
  });

  const durationMs = performance.now() - startTime;
  const cpuDiff = process.cpuUsage(startCpu);
  const cpuMs = (cpuDiff.user + cpuDiff.system) / 1000;

  // Best-effort body size read. Cloning lets us consume the body without
  // disturbing the response Hono is about to return. Streaming responses
  // (none today, but possible in future) would fall through to 0.
  let responseBytes = 0;
  try {
    const cloned = c.res.clone();
    const buf = await cloned.arrayBuffer();
    responseBytes = buf.byteLength;
  } catch {
    responseBytes = 0;
  }

  flushMetric({
    ctx,
    statusCode: c.res.status,
    durationMs,
    cpuMs,
    responseBytes,
  });
};
