import { expect, type Page } from "@playwright/test"

// The lead page's tabs (#228) and its More menu, for specs that work on it.

export type LeadTabName = "Overview" | "Interview" | "School fee" | "Follow-ups" | "Discounts"

const TAB_PARAMS: Record<LeadTabName, string> = {
  Overview: "",
  Interview: "?tab=interview",
  "School fee": "?tab=school-fee",
  "Follow-ups": "?tab=follow-ups",
  Discounts: "?tab=discounts",
}

// The lead page's address on a tab.
export function leadUrl(leadId: string, tab: LeadTabName = "Overview"): string {
  return `/staff/applicants/${leadId}${TAB_PARAMS[tab]}`
}

// Switches the open lead page to a tab, as staff do.
export async function openLeadTab(page: Page, tab: LeadTabName): Promise<void> {
  const link = page.getByRole("navigation", { name: "Application sections" }).getByRole("link", { name: tab, exact: true })
  await link.click()
  await expect(link).toHaveAttribute("aria-current", "page")
}

export type MoreAction = "Decline" | "Mark inactive" | "Archive" | "Request reopening"

// The header's More popover (#325): a kit popover named "More actions", whose
// actions are buttons, and a link for Request reopening.
function morePopover(page: Page) {
  return page.getByRole("dialog", { name: "More actions" })
}

// Opens the header's More menu and picks an action.
export async function chooseMore(page: Page, action: MoreAction): Promise<void> {
  await page.getByRole("button", { name: "More actions", exact: true }).click()
  const popover = morePopover(page)
  await expect(popover).toBeVisible()
  await popover.getByRole(action === "Request reopening" ? "link" : "button", { name: action, exact: true }).click()
}

// The actions the More menu offers on the open lead page, none when there is
// no More.
export async function moreActions(page: Page): Promise<string[]> {
  // Wait for the page itself, not its loading skeleton, before counting.
  await expect(page.getByRole("navigation", { name: "Application sections" })).toBeVisible()
  const more = page.getByRole("button", { name: "More actions", exact: true })
  if ((await more.count()) === 0) return []
  await more.click()
  const popover = morePopover(page)
  await expect(popover).toBeVisible()
  // Its actions in order; the screen-reader Close is not one of them.
  const items = await popover.locator("a.kit-btn, button.kit-btn").allTextContents()
  await page.keyboard.press("Escape")
  await expect(popover).toHaveCount(0)
  return items.map((item) => item.trim())
}
