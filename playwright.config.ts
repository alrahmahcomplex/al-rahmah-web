import { defineConfig, devices } from "@playwright/test"

import "./tests/support/env"
import { E2E_PORT, E2E_TURNSTILE_FAILS_PORT } from "./e2e/server"

// Cloudflare's published Turnstile test keys: the site key always passes in
// the browser, and the secrets make siteverify always pass or always fail.
const TURNSTILE_SITE_KEY = "1x00000000000000000000AA"
const TURNSTILE_PASSES = "1x0000000000000000000000000000000AA"
const TURNSTILE_FAILS = "2x0000000000000000000000000000000AA"

// The specs that run against the second server, whose Turnstile secret always
// fails: the public forms' fail-closed path.
const FAILS_SPECS = /\.turnstile-fails\.spec\.ts$/

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
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: FAILS_SPECS },
    {
      name: "turnstile-fails",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${E2E_TURNSTILE_FAILS_PORT}` },
      testMatch: FAILS_SPECS,
    },
  ],
  webServer: [
    {
      // CI builds in its own step first.
      command: process.env.CI ? `npx next start -p ${E2E_PORT}` : `npm run build && npx next start -p ${E2E_PORT}`,
      url: `http://localhost:${E2E_PORT}`,
      // Locally, a server already on the port (`npm run e2e:serve`) is reused so
      // reruns skip the build. Global setup then refuses it unless it serves this
      // checkout's own build. CI always builds fresh.
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      // The site key is built into the page, so it is set for the build too.
      env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY: TURNSTILE_PASSES },
    },
    {
      // The same build, started once the first server is up, with the secret
      // that always fails.
      command: `npx next start -p ${E2E_TURNSTILE_FAILS_PORT}`,
      url: `http://localhost:${E2E_TURNSTILE_FAILS_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY: TURNSTILE_FAILS },
    },
  ],
})
