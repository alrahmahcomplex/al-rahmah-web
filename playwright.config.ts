import { existsSync } from "node:fs"

import { defineConfig, devices } from "@playwright/test"

// The app and these tests both talk to local Supabase (`npm run db:start`).
if (existsSync(".env.local")) process.loadEnvFile(".env.local")

// A dedicated port, never reused: if something else already listens here the
// run fails instead of silently testing another worktree's server.
const PORT = 3100

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
