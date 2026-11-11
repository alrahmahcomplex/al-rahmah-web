import { test } from "./staff-test"

// The console-error guard of e2e/staff-test.ts fails a test (test.fail marks
// each failure below as the expected outcome). No server needed: each page
// is written in place.

const throws = "<script>setTimeout(() => { throw new Error('boom') })</script>"
const logs = "<script>console.error('broken render')</script>"

test.describe("the console-error guard", () => {
  test.fail("fails a test whose page writes console.error", async ({ page }) => {
    await page.setContent(logs)
  })

  test.fail("fails a test whose page throws", async ({ page }) => {
    await page.setContent(throws)
    await page.waitForTimeout(100)
  })

  test.fail("fails a test when a browser it opened itself writes console.error", async ({ browser }) => {
    const context = await browser.newContext()
    await (await context.newPage()).setContent(logs)
    await context.close()
  })

  test.fail("fails a test when a page from browser.newPage() throws", async ({ browser }) => {
    const page = await browser.newPage()
    await page.setContent(throws)
    await page.waitForTimeout(100)
    await page.close()
  })

  test("passes a message the test allows for itself", async ({ page, allowConsoleError }) => {
    allowConsoleError(/^console\.error: broken render$/, "this test writes it on purpose")
    await page.setContent(logs)
  })

  test.fail("still fails on a message the test did not allow", async ({ page, allowConsoleError }) => {
    allowConsoleError(/^console\.error: something else$/, "a different message")
    await page.setContent(logs)
  })

  test("passes a page that only logs and warns", async ({ page }) => {
    await page.setContent("<p>quiet</p><script>console.log('fine'); console.warn('fine')</script>")
  })
})
