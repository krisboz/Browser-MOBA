import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // Server tests that need Postgres create and drop their own databases.
    testTimeout: 20_000,
  },
});
