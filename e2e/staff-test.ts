import { expect, test as base, type BrowserContext } from "@playwright/test"

// The test function of every staff spec (#317). It fails a test when a page
// in any browser context the test uses throws an uncaught error or writes
// console.error: a hydration mismatch, a failed render or a broken script
// that the test's own steps would not notice. That covers the test's own
// context and every one it opens with browser.newContext() or
// browser.newPage(). tests/unit/staff-spec-guard.test.ts checks that every
// spec opening /staff imports `test` from here; e2e/staff-test.spec.ts shows
// the guard failing a test.
//
// A test that makes a request fail on purpose (aborts it, or answers it with
// an error) names the message it expects, for that test only:
//
//   test("…", async ({ page, allowConsoleError }) => {
//     allowConsoleError(/ERR_FAILED \(http:\/\/[^)]+\/staff\/check-in\)$/, "this test drops the request")

type Allowance = { pattern: RegExp; reason: string }

/** Messages expected in every test, each with the reason it is not a defect. */
export const ALLOWED_CONSOLE_ERRORS: Allowance[] = [
  {
    pattern: /^console\.error: Failed to load resource: .*\(https?:\/\/[^/]+\/_vercel\/(insights|speed-insights)\/script\.js\)$/,
    reason: "Vercel serves the Analytics and Speed Insights scripts only on its own hosts; next start answers 404",
  },
]

export const test = base.extend<{
  consoleAllowances: Allowance[]
  /** Allows a message in this test only, for a failure the test causes on purpose. */
  allowConsoleError: (pattern: RegExp, reason: string) => void
  consoleGuard: void
}>({
  consoleAllowances: async ({}, provide) => {
    await provide([])
  },
  allowConsoleError: async ({ consoleAllowances }, provide) => {
    await provide((pattern, reason) => {
      if (!reason.trim()) throw new Error("allowConsoleError needs a reason")
      consoleAllowances.push({ pattern, reason })
    })
  },
  consoleGuard: [
    async ({ context, browser, consoleAllowances }, runTest) => {
      const errors: string[] = []
      const watched = new WeakSet<BrowserContext>()
      const watch = (watching: BrowserContext) => {
        if (watched.has(watching)) return
        watched.add(watching)
        watching.on("weberror", (error) => errors.push(`pageerror: ${error.error().message}`))
        watching.on("console", (message) => {
          if (message.type() !== "error") return
          const url = message.location().url
          errors.push(`console.error: ${message.text()}${url ? ` (${url})` : ""}`)
        })
      }
      watch(context)
      // browser.newPage() opens its context through browser.newContext(), so
      // wrapping that one method covers both. The browser is shared by the
      // worker's tests, so the wrapper comes off when the test ends.
      const newContext = browser.newContext
      browser.newContext = async (...args) => {
        const opened = await newContext.apply(browser, args)
        watch(opened)
        return opened
      }
      try {
        await runTest()
      } finally {
        browser.newContext = newContext
      }
      const allowed = [...ALLOWED_CONSOLE_ERRORS, ...consoleAllowances]
      const unexpected = errors.filter((error) => !allowed.some(({ pattern }) => pattern.test(error)))
      expect(unexpected, "the page wrote errors to the console").toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
