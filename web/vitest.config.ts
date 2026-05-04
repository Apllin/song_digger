import { defineConfig } from "vitest/config";
import path from "node:path";

// Default `vitest run` covers fast unit tests under lib/ and app/.
// Smoke and speed suites under tests/ are opt-in via dedicated scripts
// (test:smoke / test:speed) — they hit live services or measure latency
// and should never run as part of the regular test pass.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    exclude: ["node_modules/**", "tests/smoke/**", "tests/speed/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
