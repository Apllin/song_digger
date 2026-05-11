import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/app/generated/prisma/client";
import { metricsStorage } from "@/lib/metrics/context";

// Per-query hook for cost telemetry: bumps the current request's
// MetricsContext (if any). When no context is active (e.g. Hono extension
// flushing its own RequestMetric row, scripts, or startup code) the
// extension is a no-op. Safe to call from any code path.
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const adapter = new PrismaPg({ connectionString });
  const base = new PrismaClient({ adapter });
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const ctx = metricsStorage.getStore();
          if (!ctx) return query(args);
          const start = performance.now();
          try {
            return await query(args);
          } finally {
            ctx.dbQueryCount += 1;
            ctx.dbQueryMs += performance.now() - start;
          }
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
