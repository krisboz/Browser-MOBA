import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // Server tests that need Postgres create and drop their own databases; dropping them all at the end
    // takes over 10 s on some machines (native Postgres on Windows).
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
