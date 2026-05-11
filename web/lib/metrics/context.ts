import { AsyncLocalStorage } from "node:async_hooks";

// Per-request mutable bag shared between the Hono middleware (sync request
// path), the Prisma query extension (counts every DB call), and handlers
// that capture domain-specific facts like Python wall time or cache hit.
//
// `route` is set up front by whoever opens the context (Hono middleware =
// pathname + method, background helper = "BG /api/search" etc.) so the
// flush at the end has a stable key without re-deriving from c.req.
export type MetricsContext = {
  route: string;
  method: string;
  userId: string | null;
  dbQueryCount: number;
  dbQueryMs: number;
  pythonDurationMs: number;
  cacheHit: boolean | null;
  sourcesUsed: string[] | null;
};

// Pinned on globalThis so Next.js HMR doesn't create a second instance.
// Without this, the Prisma client (also cached on globalThis) keeps a
// closure referencing the original AsyncLocalStorage object while fresh
// module evaluations hand out a new one — `setStore` and `getStore` end
// up on different instances and the extension always sees undefined.
const globalForMetrics = globalThis as unknown as {
  metricsStorage: AsyncLocalStorage<MetricsContext> | undefined;
};

export const metricsStorage: AsyncLocalStorage<MetricsContext> =
  globalForMetrics.metricsStorage ?? new AsyncLocalStorage<MetricsContext>();

if (process.env.NODE_ENV !== "production") {
  globalForMetrics.metricsStorage = metricsStorage;
}

export function getMetricsContext(): MetricsContext | undefined {
  return metricsStorage.getStore();
}

export function createEmptyContext(route: string, method: string, userId: string | null): MetricsContext {
  return {
    route,
    method,
    userId,
    dbQueryCount: 0,
    dbQueryMs: 0,
    pythonDurationMs: 0,
    cacheHit: null,
    sourcesUsed: null,
  };
}
