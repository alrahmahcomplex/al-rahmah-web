import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
      {
        // The database tests: services and SQL against local Supabase, no
        // browser and no Next.js server. `npm run test:integration` runs four
        // files at a time; more sign-ins at once have failed with
        // AuthRetryableFetchError. If that returns, rerun with
        // `--no-file-parallelism`.
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/env.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          // In CI a test that fails from load is tried again, up to two times,
          // and only that test: "unavailable" when test files that create and
          // lock leads in the same seconds fill the connection pool, and the
          // AuthRetryableFetchError of docs/agents/parallel-work.md. A test
          // that fails for any other reason fails at once. The log marks each
          // retried test, and scripts/ci-flaky.mjs lists them.
          retry: process.env.CI ? { count: 2, delay: 1_000, condition: /unavailable|AuthRetryableFetchError/ } : 0,
        },
      },
    ],
  },
})
