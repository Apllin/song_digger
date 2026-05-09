import path from "node:path";
import { defineConfig } from "vitest/config";

// Speed suite — opt-in via `pnpm test:speed`. Latency measurements are
// only meaningful when nothing else competes for CPU/network on the
// box; force single-thread, no file parallelism. Long timeouts so a
// 10-concurrent test or end-to-end /api/search measurement fits.
//
// Vitest 4: pool config moved to top-level (no more poolOptions). See
// node_modules/.pnpm/vitest@4*/node_modules/vitest/dist/chunks/reporters.d.*.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/speed/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    isolate: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
