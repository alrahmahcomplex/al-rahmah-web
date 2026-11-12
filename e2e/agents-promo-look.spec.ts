import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"

import { lookFor } from "@/app/staff/route-looks"

import { registerPendingAgent } from "../tests/support/agents"
import { secretClient, signedIn } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// Marketing Agents, its import, Promo codes and WhatsApp groups in the kit
// (#330): axe on each screen and on each sheet a Manager can open, at desktop
// and phone widths, then the sheets under reduced motion. Every sheet closes
// again unsaved. Set R8_SHOTS to a folder to keep a capture of each.

// The seeded Approved agent, whose row carries every action but Approve.
const SEEDED = "Baraka Juma Njoroge"

async function open(page: Page, url: string) {
  await signInOnce(page, MANAGER.email, MANAGER.password)
  await page.goto(url)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  if (lookFor(new URL(url, "http://x").pathname) === "new") await expect(page.locator('[data-shell="new"][data-live]')).toBeVisible()
}

async function shot(page: Page, name: string) {
  const folder = process.env.R8_SHOTS
  if (folder) await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true })
}

/** Axe inside the open sheet, then Escape, which closes it unsaved. */
async function checkSheet(page: Page, name: string | RegExp, file: string) {
  const sheet = page.getByRole("dialog", { name })
  await expect(sheet).toBeVisible()
  // The pointer rests where the opener was; a row's hover tint under it is not what the sheet looks like.
  await page.mouse.move(0, 0)
  expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
  await shot(page, file)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

async function newPromo(): Promise<string> {
  const code = `LOOK${randomInt(1000, 9999)}${randomUUID().slice(0, 2).toUpperCase()}`
  const { error } = await (await signedIn(MANAGER)).rpc("create_promo_code", { name: `Look ${code}`, code, amount: 20_000, ends_on: null, note: null })
  if (error) throw new Error(`setup failed: ${error.message}`)
  return code
}

/** An Approved agent with no email who then claims one at sign-up, as the queue shows (#193). */
async function waitingClaim(): Promise<string> {
  const fullName = `Look Claim ${randomUUID().slice(0, 6)}`
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  const phone = `07${String(randomInt(10_000_000, 100_000_000))}`
  const { data, error } = await (await signedIn(MANAGER)).rpc("create_marketing_agent", { full_name: fullName, phone, whatsapp: "", email: "", code: "" })
  const made = data as { outcome: string; agent: { code: string } } | null
  if (error || made?.outcome !== "created") throw new Error(`setup failed: ${JSON.stringify(error ?? made)}`)
  const claim = await secretClient().rpc("sign_up_marketing_agent", {
    full_name: fullName,
    phone,
    whatsapp: "",
    email: `look-claim-${randomUUID().slice(0, 8)}@example.test`,
    has_code: true,
    code: made.agent.code,
  })
  if (claim.error) throw new Error(`setup failed: ${claim.error.message}`)
  return fullName
}

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test("Marketing Agents and the sheets on an agent's row", async ({ page }) => {
      await open(page, `/staff/agents?status=all&q=${encodeURIComponent(SEEDED)}`)
      expect(await axeProblems(page)).toEqual([])
      await shot(page, `agents-${width}`)

      await page.getByRole("button", { name: "Add agent" }).click()
      await checkSheet(page, "Add agent", `agents-add-${width}`)
      await page.getByRole("button", { name: "Change the standard discount" }).click()
      await checkSheet(page, "Standard discount", `agents-standard-${width}`)

      const row = page.getByRole("row", { name: new RegExp(SEEDED) })
      await row.getByRole("button", { name: /^Interview discount for/ }).click()
      await checkSheet(page, SEEDED, `agents-discount-${width}`)
      // A joined agent's email is theirs to change, so its button is off.
      const email = row.getByRole("button", { name: /^(Add|Edit) email for/ })
      if ((await email.count()) > 0 && (await email.isEnabled())) {
        await email.click()
        await checkSheet(page, /email for/, `agents-email-${width}`)
      }
      await row.getByRole("button", { name: `Switch off ${SEEDED}` }).click()
      await checkSheet(page, `Switch off ${SEEDED}?`, `agents-switch-off-${width}`)
      await row.getByRole("button", { name: `Retire ${SEEDED}` }).click()
      await checkSheet(page, `Retire ${SEEDED}?`, `agents-retire-${width}`)
      await row.getByRole("button", { name: `Recreate ${SEEDED}` }).click()
      await expect(page.getByRole("dialog").getByLabel("Full name")).toHaveValue(SEEDED)
      await checkSheet(page, `Recreate ${SEEDED}?`, `agents-recreate-${width}`)
    })

    test("Approve on a Pending agent's row", async ({ page }) => {
      const fullName = `Look Pending ${randomUUID().slice(0, 6)}`
      const { code } = await registerPendingAgent({ fullName, phone: `07${String(randomInt(10_000_000, 100_000_000))}` })
      await open(page, `/staff/agents?status=pending&q=${encodeURIComponent(code)}`)
      await page.getByRole("row", { name: new RegExp(fullName) }).getByRole("button", { name: `Approve ${fullName}` }).click()
      await checkSheet(page, `Approve ${fullName}?`, `agents-approve-${width}`)
    })

    test("Send invites on Approved, no account yet", async ({ page }) => {
      // playwright.config.ts sets the invite budget, so the button is on.
      await open(page, "/staff/agents?account=no-account")
      expect(await axeProblems(page)).toEqual([])
      await shot(page, `agents-no-account-${width}`)
      await page.getByRole("button", { name: "Send invites" }).click()
      await checkSheet(page, /^Send invites/, `agents-send-invites-${width}`)
    })

    test("the claim queue and Save and send invite", async ({ page }) => {
      const fullName = await waitingClaim()
      await open(page, "/staff/agents?account=awaiting-confirmation")
      const card = page.getByRole("region", { name: new RegExp(`^${fullName}`) })
      await expect(card).toBeVisible()
      expect(await axeProblems(page)).toEqual([])
      await shot(page, `agents-claims-${width}`)
      await card.getByRole("button", { name: `Save and send invite for ${fullName}` }).click()
      await checkSheet(page, `Save and send invite for ${fullName}`, `agents-claim-send-${width}`)
    })

    test("Import agents", async ({ page }) => {
      await open(page, "/staff/agents/import")
      expect(await axeProblems(page)).toEqual([])
      await shot(page, `import-${width}`)
    })

    test("Promo codes and its sheets", async ({ page }) => {
      const code = await newPromo()
      await open(page, "/staff/promo-codes")
      expect(await axeProblems(page)).toEqual([])
      await shot(page, `promo-${width}`)
      await page.getByRole("button", { name: "New Promo code" }).click()
      await checkSheet(page, "New Promo code", `promo-new-${width}`)
      await page.getByRole("row", { name: `Open ${code}` }).click()
      const sheet = page.getByRole("dialog", { name: code })
      await sheet.getByText("More options").click()
      await sheet.getByRole("button", { name: "Pause code" }).click()
      await checkSheet(page, code, `promo-edit-${width}`)
    })

    test("WhatsApp groups", async ({ page }) => {
      await open(page, "/staff/group-links")
      expect(await axeProblems(page)).toEqual([])
      await shot(page, `groups-${width}`)
    })
  })
}

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("the agent and Promo code sheets fade in place", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page, `/staff/agents?status=all&q=${encodeURIComponent(SEEDED)}`)
    await page.getByRole("row", { name: new RegExp(SEEDED) }).getByRole("button", { name: /^Interview discount for/ }).click()
    await expect(page.getByRole("dialog", { name: SEEDED })).toHaveCSS("transition-property", "opacity")
    await page.keyboard.press("Escape")

    await page.goto("/staff/promo-codes")
    await page.getByRole("button", { name: "New Promo code" }).click()
    await expect(page.getByRole("dialog", { name: "New Promo code" })).toHaveCSS("transition-property", "opacity")
  })
})
