import { createEmptyContext, type MetricsContext, metricsStorage } from "./context";
import { flushMetric } from "./flush";

// Wrap a fire-and-forget background task so it gets its own RequestMetric
// row. Without this, async work spawned from a request handler keeps
// inheriting the request's AsyncLocalStorage context — but by the time the
// task's DB calls land, the request's row has already been flushed, so the
// counter bumps are lost. Opening a fresh context per background task
// captures the post-response cost (search worker is the canonical example —
// Python fan-out + saveTracks dominate cost but happen after the POST has
// returned 202).
//
// `route` should be prefixed with `BG ` so a SQL aggregate by route cleanly
// separates synchronous request work from background work.
//
// The callback receives the context so it can attach domain facts
// (cacheHit, pythonDurationMs, sourcesUsed) without re-reading the store.
//
// Always resolves — failures inside `task` are logged and the metric row is
// still written with the partial counters and statusCode 500.
export async function runWithMetrics(
  route: string,
  userId: string | null,
  task: (ctx: MetricsContext) => Promise<void>,
): Promise<void> {
  // `exit` detaches from any parent metricsStorage context. Without this,
  // a background task spawned from inside the request middleware inherits
  // the parent's store: the inner `.run()` for "BG /..." correctly wraps
  // the worker's queries, but once it exits, AsyncLocalStorage pops back
  // to the parent's store — so `flushMetric` for the BG row would write
  // its `RequestMetric.create` against the parent route's already-flushed
  // ctx instead of cleanly outside any context.
  await metricsStorage.exit(async () => {
    const ctx = createEmptyContext(route, "BG", userId);
    const startTime = performance.now();
    const startCpu = process.cpuUsage();
    let statusCode = 200;

    try {
      await metricsStorage.run(ctx, async () => {
        await task(ctx);
      });
    } catch (err) {
      statusCode = 500;
      console.error(`[metrics] background task '${route}' failed:`, err);
    }

    const durationMs = performance.now() - startTime;
    const cpuDiff = process.cpuUsage(startCpu);
    const cpuMs = (cpuDiff.user + cpuDiff.system) / 1000;

    flushMetric({
      ctx,
      statusCode,
      durationMs,
      cpuMs,
      responseBytes: 0,
    });
  });
}
