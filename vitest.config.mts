import react from "@vitejs/plugin-react"
import { defineConfig, type TestProjectInlineConfiguration } from "vitest/config"

// What both database projects share: services and SQL against local
// Supabase, no browser and no Next.js server.
const database: NonNullable<TestProjectInlineConfiguration["test"]> = {
  environment: "node",
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
}

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
        // `npm run test:integration` runs four files at a time; more
        // sign-ins at once have failed with AuthRetryableFetchError. If that
        // returns, rerun with `--no-file-parallelism`.
        extends: true,
        test: {
          ...database,
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude: ["tests/integration/serial/**"],
        },
      },
      {
        // Tests that change something the whole database shares, such as
        // the Sibling kill switch: resuming it recomputes every sibling
        // group, other files' groups included. They run after every other
        // integration file has finished, one file at a time, so no other
        // test is running when they do.
        extends: true,
        test: {
          ...database,
          name: "integration-serial",
          include: ["tests/integration/serial/**/*.test.ts"],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
