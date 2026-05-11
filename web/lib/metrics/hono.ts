import type { MiddlewareHandler } from "hono";

import { auth } from "@/lib/auth";
import type { RequestMetricsVar } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

export const metricsMiddleware: MiddlewareHandler = async (c, next) => {
  const session = await auth().catch(() => null);

  const metrics: RequestMetricsVar = {
    userId: session?.user?.id ?? null,
    pythonDurationMs: null,
    cacheHit: null,
    sourcesUsed: null,
  };
  c.set("metrics", metrics);

  const startTime = performance.now();
  const startCpu = process.cpuUsage();

  await next();

  const durationMs = performance.now() - startTime;
  const cpuDiff = process.cpuUsage(startCpu);
  const cpuMs = (cpuDiff.user + cpuDiff.system) / 1000;

  let responseBytes = 0;
  try {
    const buf = await c.res.clone().arrayBuffer();
    responseBytes = buf.byteLength;
  } catch {
    responseBytes = 0;
  }

  const url = new URL(c.req.url);

  prisma.requestMetric
    .create({
      data: {
        route: url.pathname,
        method: c.req.method,
        statusCode: c.res.status,
        durationMs: Math.round(durationMs),
        cpuMs: Math.round(cpuMs),
        responseBytes,
        pythonDurationMs: metrics.pythonDurationMs !== null ? Math.round(metrics.pythonDurationMs) : null,
        cacheHit: metrics.cacheHit,
        sourcesUsed: metrics.sourcesUsed ?? undefined,
        userId: metrics.userId,
      },
    })
    .catch((err: unknown) => {
      console.error("[metrics] failed to write RequestMetric:", err);
    });
};
