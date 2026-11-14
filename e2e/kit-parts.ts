import { expect, type Locator } from "@playwright/test"

import { showDayFirst } from "../components/kit/dates"

// Helpers for specs on screens drawn with the kit's form parts (#358). The
// kit's choice list is our own popup, not a native <select>, so a spec picks
// an option the way a person does; the kit's date field shows the day first.

/** Picks `option` in a kit Select: opens the list, clicks the option by its exact name, and waits for the list to close. */
export async function chooseOption(field: Locator, option: string): Promise<void> {
  await field.click()
  const list = field.page().getByRole("listbox")
  await list.getByRole("option", { name: option, exact: true }).click()
  await expect(list).toBeHidden()
}

/** A kit date field shows "DD/MM/YYYY" and posts "YYYY-MM-DD": `dayFirst("2026-09-05")` is "05/09/2026", for `fill` and `toHaveValue`. */
export const dayFirst = showDayFirst
