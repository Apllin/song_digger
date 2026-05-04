import { defineConfig } from "vitest/config";
import path from "node:path";

// Smoke suite — opt-in via `pnpm test:smoke`. Some tests hit the dev
// servers (uvicorn + next dev); others verify pure aggregator behavior
// with crafted source lists. Single-thread to keep network-bound
// measurements consistent and avoid Postgres connection pile-up.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/smoke/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
