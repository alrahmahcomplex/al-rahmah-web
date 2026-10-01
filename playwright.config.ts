import { defineConfig, devices } from "@playwright/test"

import "./tests/support/env"
import { E2E_PORT } from "./e2e/server"

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI builds in its own step first.
    command: process.env.CI ? `npx next start -p ${E2E_PORT}` : `npm run build && npx next start -p ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}`,
    // Locally, a server already on the port (`npm run e2e:serve`) is reused so
    // reruns skip the build. Global setup then refuses it unless it serves this
    // checkout's own build. CI always builds fresh.
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
})
