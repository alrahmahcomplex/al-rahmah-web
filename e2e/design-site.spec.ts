import { randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"

import { DESIGN_PASSWORD, openDesign } from "./design"
import { expect, test } from "./staff-test"

// The design site (prototype v6): the lock screen, the Design system page's
// sections in the sidebar and its search, Connect an AI, llms.txt and the MCP
// server. Locally it is /design; design.alrahmahcomplex.or.tz serves the same
// pages at its root (tests/unit/design-site-hosts.test.ts). Each test gives
// its own address in x-real-ip, so the wrong-password limit counts it alone.

const asAddress = (page: Page) => page.setExtraHTTPHeaders({ "x-real-ip": `10.${randomUUID()}` })

test.describe("the lock screen", () => {
  test("asks for the password, says when it is wrong, opens the page in place, and locks again", async ({ page }) => {
    await asAddress(page)
    await page.goto("/design/connect")
    const password = page.getByRole("textbox", { name: "Password" })
    await expect(page.getByRole("heading", { name: "Design system", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Connect an AI" })).toHaveCount(0)

    await page.getByRole("button", { name: "Open" }).click()
    await expect(password).toHaveAccessibleDescription("Enter the password.")

    await password.fill("not the password")
    await page.getByRole("button", { name: "Show password" }).click()
    await expect(password).toHaveAttribute("type", "text")
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "Open" }).click()
    await expect(password).toHaveAccessibleDescription("That password isn’t right. Check it and try again.")
    await expect(password).toHaveAttribute("aria-invalid", "true")

    await password.fill(DESIGN_PASSWORD)
    await page.getByRole("button", { name: "Open" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Connect an AI" })).toBeVisible()
    await expect(page).toHaveURL(/\/design\/connect$/)

    // The browser stays open: another design page opens straight away.
    await page.goto("/design")
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible()

    await page.getByRole("banner").getByRole("button", { name: /Open.*For 30 days/ }).click()
    await page.getByRole("button", { name: "Lock this browser" }).click()
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible()
  })
})

test.describe("the Design system page", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("lists its sections under its row; pressing one scrolls to it and marks it", async ({ page }) => {
    await openDesign(page)
    await expect(page.locator('[data-shell="new"][data-live]')).toBeVisible()
    const sidebar = page.getByRole("complementary", { name: "Sidebar" })
    await expect(sidebar.getByRole("link", { name: "Design system" })).toHaveAttribute("aria-current", "page")
    await expect(sidebar.getByRole("link", { name: "Colour" })).toHaveAttribute("aria-current", "location")

    await sidebar.getByRole("button", { name: "Inputs" }).click()
    await expect(sidebar.getByRole("button", { name: "Inputs" })).toHaveAttribute("aria-expanded", "true")
    await expect(sidebar.getByRole("button", { name: "Foundations" })).toHaveAttribute("aria-expanded", "false")
    await sidebar.getByRole("link", { name: /Password field/ }).click()
    await expect(page.getByRole("region", { name: "Password field" })).toBeInViewport()
    await expect(sidebar.getByRole("link", { name: /Password field/ })).toHaveAttribute("aria-current", "location")

    // Scrolling the stage moves the mark and opens the group it is in.
    await page.getByRole("region", { name: "Timeline" }).scrollIntoViewIfNeeded()
    await page.locator(".ns-scroll").evaluate((el) => el.scrollBy(0, 1))
    await expect(sidebar.getByRole("button", { name: "Layout and lists" })).toHaveAttribute("aria-expanded", "true")

    // The chevron folds the list away.
    await sidebar.getByRole("button", { name: "Design system sections" }).click()
    await expect(sidebar.getByRole("link", { name: "Colour" })).toHaveCount(0)
  })

  test("the search shows only the parts it matches, and says so when none does", async ({ page }) => {
    await openDesign(page)
    const search = page.getByRole("searchbox", { name: "Search the design system" })
    await search.fill("password")
    await expect(page.getByRole("region", { name: "Password field" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Colour" })).toHaveCount(0)
    await search.fill("nothing-is-called-this")
    await expect(page.getByText("No part matches")).toBeVisible()
    await search.fill("")
    await expect(page.getByRole("region", { name: "Colour" })).toBeVisible()
  })

  test("the password field's eye shows and hides what is typed", async ({ page }) => {
    await openDesign(page)
    const card = page.getByRole("region", { name: "Password field" })
    const field = card.getByRole("textbox", { name: "Example password, filled" })
    await expect(field).toHaveAttribute("type", "password")
    await card.getByRole("button", { name: "Show password" }).last().click()
    await expect(field).toHaveAttribute("type", "text")
    await card.getByRole("button", { name: "Hide password" }).click()
    await expect(field).toHaveAttribute("type", "password")
  })
})

test.describe("Connect an AI", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] })

  test("shows the password as dots, and the copy buttons copy the real one", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await openDesign(page, "/design/connect")
    await expect(page.getByRole("heading", { level: 1, name: "Connect an AI" })).toBeVisible()
    await expect(page.getByText(DESIGN_PASSWORD)).toHaveCount(0)

    await page.getByRole("button", { name: "Copy link" }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`http://localhost:3100/llms.txt?key=${encodeURIComponent(DESIGN_PASSWORD)}`)

    await page.getByRole("tab", { name: "Codex" }).click()
    await page.getByRole("button", { name: "Copy settings" }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`Authorization = "Bearer ${DESIGN_PASSWORD}"`)
  })
})

test.describe("llms.txt and the MCP server", () => {
  const address = () => ({ "x-real-ip": `10.${randomUUID()}` })

  test("llms.txt needs the password in the link, then gives the design system, or one part", async ({ request }) => {
    const refused = await request.get("/design-api/llms", { headers: address() })
    expect(refused.status()).toBe(401)

    const page = await request.get(`/design-api/llms?key=${encodeURIComponent(DESIGN_PASSWORD)}`, { headers: address() })
    expect(page.status()).toBe(200)
    expect(page.headers()["content-type"]).toContain("text/plain")
    const text = await page.text()
    expect(text).toContain("# Al-Rahmah Complex design system")
    expect(text).toContain("The Kit First Rule")

    const part = await request.get(`/design-api/llms?key=${encodeURIComponent(DESIGN_PASSWORD)}&part=code-block`, { headers: address() })
    expect(await part.text()).toContain("export function CodeBlock")
  })

  test("the MCP server needs the password in a header, then answers JSON-RPC", async ({ request }) => {
    const rpc = (body: unknown, auth = true) =>
      request.post("/design-api/mcp", { headers: { ...address(), ...(auth ? { Authorization: `Bearer ${DESIGN_PASSWORD}` } : {}) }, data: body })

    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, false)).status()).toBe(401)

    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } })
    expect(await init.json()).toMatchObject({ result: { serverInfo: { name: "alrahmah-design" } } })
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status()).toBe(202)

    const call = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_part", arguments: { name: "buttons" } } })
    const reply = await call.json()
    expect(reply.result.content[0].text).toContain("export function Button")

    expect((await request.get("/design-api/mcp")).status()).toBe(405)
  })
})
