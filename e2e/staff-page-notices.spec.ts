import { expect, test } from "./staff-test"

import { ADMISSIONS, MANAGER, SUPER_ADMIN, type FixtureStaff } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"

// A staff page that has nothing to show draws its notice itself (#441): a
// role without the page's permission gets "Not available to your role", a
// record that is not there gets "This page does not exist". Thrown inside
// the page's streamed loading boundary, they made React report error #419
// once the person left the page, so each test leaves by the notice's own way
// back. The console guard fails a test on any page error.

const NO_SUCH_ID = "00000000-0000-4000-8000-000000000000"
const FORBIDDEN = "Not available to your role"
const NOT_FOUND = "This page does not exist"

// Seats is no case here since streams (#449): everyone who may view payments
// opens it, and every seeded role may.
const CASES: { what: string; who: FixtureStaff; path: string; heading: string }[] = [
  { what: "Reports, for Admissions Staff", who: ADMISSIONS, path: "/staff/reports", heading: FORBIDDEN },
  { what: "an application that is not there", who: MANAGER, path: `/staff/applicants/${NO_SUCH_ID}`, heading: NOT_FOUND },
  { what: "reopening an application that is not there", who: MANAGER, path: `/staff/applicants/${NO_SUCH_ID}/reopen`, heading: NOT_FOUND },
  { what: "the history of an application that is not there", who: SUPER_ADMIN, path: `/staff/applicants/${NO_SUCH_ID}/history`, heading: NOT_FOUND },
  { what: "a re-application that is not there", who: MANAGER, path: `/staff/re-applications/${NO_SUCH_ID}`, heading: NOT_FOUND },
  { what: "a Fee schedule year that is not a year", who: MANAGER, path: "/staff/fees/abc", heading: NOT_FOUND },
]

for (const { what, who, path, heading } of CASES) {
  test(`${what}: the notice opens and is left with no page errors`, async ({ page }) => {
    await signInOnce(page, who.email, who.password)
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
    // The old shell's way back is a link drawn as a button; the new shell's is a link.
    const back = page.getByRole("link", { name: "Back to the staff area" }).or(page.getByRole("button", { name: "Back to the staff area" }))
    await back.click()
    await expect(page).toHaveURL(/\/staff$/)
    await expect(page.getByRole("heading", { level: 1, name: heading })).toHaveCount(0)
  })
}
