import { expect, test as base, type BrowserContext } from "@playwright/test"

// The test function of every staff spec (#317). It fails a test when a page
// in any browser context the test uses throws an uncaught error or writes
// console.error: a hydration mismatch, a failed render or a broken script
// that the test's own steps would not notice. That covers the test's own
// context and every one it opens with browser.newContext() or
// browser.newPage(). tests/unit/staff-spec-guard.test.ts checks that every
// spec opening /staff imports `test` from here; e2e/staff-test.spec.ts shows
// the guard failing a test.

/** Messages that are expected, each with the reason it is not a defect. */
export const ALLOWED_CONSOLE_ERRORS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /^console\.error: Failed to load resource: .*\(https?:\/\/[^/]+\/_vercel\/(insights|speed-insights)\/script\.js\)$/,
    reason: "Vercel serves the Analytics and Speed Insights scripts only on its own hosts; next start answers 404",
  },
]

export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ context, browser }, runTest) => {
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
      const unexpected = errors.filter((error) => !ALLOWED_CONSOLE_ERRORS.some(({ pattern }) => pattern.test(error)))
      expect(unexpected, "the page wrote errors to the console").toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
