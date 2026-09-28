import { existsSync } from "node:fs"

import { defineConfig, devices } from "@playwright/test"

// The app and these tests both talk to local Supabase (`npm run db:start`).
if (existsSync(".env.local")) process.loadEnvFile(".env.local")

// Each checkout's own port, written to .env.local by `npm run db:start` (3100 in
// the main checkout, 3101+ in worktrees). Never reused: if something else
// already listens here the run fails instead of testing another worktree's server.
const PORT = Number(process.env.E2E_PORT ?? 3100)

// `npm run test:e2e` (scripts/build-lock.mts) builds the app under the build
// lock, then starts Playwright with E2E_PREBUILT set, so the webServer below
// only starts that build. Run directly, Playwright would test a stale build or
// none at all.
if (!process.env.E2E_PREBUILT) {
  throw new Error("Run the e2e tests with `npm run test:e2e` (Playwright options go after `--`). It builds the app first.")
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
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
