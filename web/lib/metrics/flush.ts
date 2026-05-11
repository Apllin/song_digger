import type { MetricsContext } from "./context";

import { prisma } from "@/lib/prisma";

type FlushArgs = {
  ctx: MetricsContext;
  statusCode: number;
  durationMs: number;
  cpuMs: number;
  responseBytes: number;
};

// Fire-and-forget write of a RequestMetric row. MUST be called from outside
// any `metricsStorage.run(...)` block — the Prisma extension would otherwise
// count this very write against the context it's writing.
//
// Numbers are rounded to integers before storing: sub-ms precision is noise
// for cost analysis and shrinks the row.
export function flushMetric({ ctx, statusCode, durationMs, cpuMs, responseBytes }: FlushArgs): void {
  prisma.requestMetric
    .create({
      data: {
        route: ctx.route,
        method: ctx.method,
        statusCode,
        durationMs: Math.round(durationMs),
        cpuMs: Math.round(cpuMs),
        responseBytes,
        dbQueryCount: ctx.dbQueryCount,
        dbQueryMs: Math.round(ctx.dbQueryMs),
        pythonDurationMs: ctx.pythonDurationMs > 0 ? Math.round(ctx.pythonDurationMs) : null,
        cacheHit: ctx.cacheHit,
        sourcesUsed: ctx.sourcesUsed ?? undefined,
        userId: ctx.userId,
      },
    })
    .catch((err: unknown) => {
      console.error("[metrics] failed to write RequestMetric:", err);
    });
}
