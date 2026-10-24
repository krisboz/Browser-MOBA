import { defineConfig } from "vitest/config";

// Pick up DATABASE_URL from .env, so the Postgres tests run locally too. Variables already set
// (as in CI) win, and with no .env the Postgres tests are simply skipped.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env
}

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // Server tests that need Postgres create and drop their own databases.
    testTimeout: 20_000,
  },
});
