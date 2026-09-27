import { existsSync } from "node:fs"

import { defineConfig, devices } from "@playwright/test"

// The app and these tests both talk to local Supabase (`npm run db:start`).
if (existsSync(".env.local")) process.loadEnvFile(".env.local")

// Each checkout's own port, written to .env.local by `npm run db:start` (3100 in
// the main checkout, 3101+ in worktrees). Never reused: if something else
// already listens here the run fails instead of testing another worktree's server.
const PORT = Number(process.env.E2E_PORT ?? 3100)

// `npm run test:e2e` waits for the build lock (scripts/build-lock.mts) before
// Playwright starts and passes its token down, so the webServer's build runs
// under it. Run directly, Playwright would queue that build inside its
// five-minute timeout and, on timing out, kill it while it holds the lock.
if (process.env.BUILD_LOCK_TOKEN === undefined && !process.env.CI) {
  throw new Error("Run the e2e tests with `npm run test:e2e` (Playwright options go after `--`), so they wait for the build lock first.")
}

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
