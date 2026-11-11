import { expect, test as base } from "@playwright/test"

// The test function of every staff spec (#317). It fails a test when a page
// in the test's browser context throws an uncaught error or writes
// console.error: a hydration mismatch, a failed render or a broken script
// that the test's own steps would not notice. tests/unit/staff-spec-guard.test.ts
// checks that every spec opening /staff imports `test` from here.
//
// A page in a browser the test opens itself (browser.newContext()) is not
// watched.

/** Messages that are expected, each with the reason it is not a defect. */
export const ALLOWED_CONSOLE_ERRORS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /^console\.error: Failed to load resource: .*\(https?:\/\/[^/]+\/_vercel\/(insights|speed-insights)\/script\.js\)$/,
    reason: "Vercel serves the Analytics and Speed Insights scripts only on its own hosts; next start answers 404",
  },
]

export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ context }, use) => {
      const errors: string[] = []
      context.on("weberror", (error) => errors.push(`pageerror: ${error.error().message}`))
      context.on("console", (message) => {
        if (message.type() !== "error") return
        const url = message.location().url
        errors.push(`console.error: ${message.text()}${url ? ` (${url})` : ""}`)
      })
      await use()
      const unexpected = errors.filter((error) => !ALLOWED_CONSOLE_ERRORS.some(({ pattern }) => pattern.test(error)))
      expect(unexpected, "the page wrote errors to the console").toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
