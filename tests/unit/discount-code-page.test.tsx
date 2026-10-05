import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef, useImperativeHandle } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const jar = vi.hoisted(() => ({ values: new Map<string, string>() }))
const stubs = vi.hoisted(() => ({ submit: vi.fn(), reset: vi.fn(), token: "fake-token" }))

vi.mock("@/lib/office", () => ({ OFFICE_PHONE: "+255 700 000 001" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
  }),
}))
// The page must render with Supabase down: any use of a Supabase client
// fails this test.
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => {
    throw new Error("the Discount code page must not read Supabase to render")
  },
}))
vi.mock("@/utils/supabase/public-form", () => ({
  publicFormClient: () => {
    throw new Error("the Discount code page must not read Supabase to render")
  },
}))
vi.mock("@/app/discount-code/actions", () => ({ registerAsAgent: stubs.submit }))
vi.mock("@/app/actions/language", () => ({ setLanguage: vi.fn() }))
vi.mock("@/components/turnstile-widget", () => ({
  TurnstileWidget: forwardRef(function FakeTurnstile({ action }: { action: string }, ref) {
    useImperativeHandle(ref, () => ({ reset: stubs.reset }))
    return <input type="hidden" name="cf-turnstile-response" value={stubs.token} data-action={action} readOnly />
  }),
}))

import DiscountCodePage, { generateMetadata } from "@/app/discount-code/page"

// Words public pages never use (CONTEXT.md, Discount code).
const FORBIDDEN = /agent|referral|approv|wakala|idhini/i

const WORDS = {
  sw: { name: "Jina lako kamili", phone: "Namba ya simu", whatsapp: "Namba ya WhatsApp (si lazima)", send: "Pata Code ya Punguzo" },
  en: { name: "Your full name", phone: "Phone number", whatsapp: "WhatsApp number (optional)", send: "Get my Discount code" },
} as const

const REGISTERED = { status: "registered", code: "RJ-407", link: "https://alrahmah.example/apply?ref=RJ-407" }

beforeEach(() => {
  jar.values.clear()
  stubs.submit.mockReset()
  stubs.reset.mockReset()
  stubs.token = "fake-token"
})

async function fill(user: ReturnType<typeof userEvent.setup>, lang: "sw" | "en" = "sw", whatsapp = "") {
  const t = WORDS[lang]
  await user.type(screen.getByLabelText(t.name), "Rehema Juma")
  await user.type(screen.getByLabelText(t.phone, { exact: true }), "0712 345 678")
  if (whatsapp) await user.type(screen.getByLabelText(t.whatsapp), whatsapp)
}

describe("the Discount code page", { timeout: 20_000 }, () => {
  it("is kept out of search engines", async () => {
    expect(await generateMetadata()).toEqual(
      expect.objectContaining({ title: "Code ya Punguzo · Al-Rahmah Complex", robots: { index: false, follow: false } }),
    )
  })

  it("renders in Swahili by default, reading no Supabase, and offers TZS 20,000 off once the school confirms", async () => {
    render(await DiscountCodePage())

    expect(screen.getByRole("main")).toHaveAttribute("lang", "sw")
    expect(screen.getByRole("heading", { level: 1, name: "Pata Code ya Punguzo" })).toBeInTheDocument()
    expect(screen.getByText(/TZS 20,000/)).toHaveTextContent(/ada ya usaili/)
    expect(screen.getByText(/TZS 20,000/)).toHaveTextContent(/shule itakapothibitisha/)
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument()
    expect(document.querySelector('input[name="cf-turnstile-response"]')).toHaveAttribute("data-action", "agent")
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
  })

  it("renders in English when the language cookie says so", async () => {
    jar.values.set("lang", "en")
    render(await DiscountCodePage())

    expect(screen.getByRole("main")).toHaveAttribute("lang", "en")
    expect(screen.getByRole("heading", { level: 1, name: "Get a Discount code" })).toBeInTheDocument()
    expect(screen.getByText(/TZS 20,000/)).toHaveTextContent(/interview fee once the school confirms/)
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
    jar.values.set("lang", "en")
    expect(await generateMetadata()).toEqual(expect.objectContaining({ title: "Discount code · Al-Rahmah Complex" }))
  })

  it("names a missing name or phone without sending", async () => {
    const user = userEvent.setup()
    render(await DiscountCodePage())

    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveAccessibleDescription(/Andika jina lako kamili/)
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveFocus()

    await user.type(screen.getByLabelText(WORDS.sw.name), "Rehema Juma")
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))
    expect(screen.getByLabelText(WORDS.sw.phone, { exact: true })).toHaveAccessibleDescription(/Andika namba yako ya simu/)
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("waits for the security check before sending", async () => {
    stubs.token = ""
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))

    expect(screen.getByRole("alert")).toHaveTextContent(/Subiri ukaguzi wa usalama/)
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("sends the entries and the token, then shows the code, the link, Copy, WhatsApp and the office phone", async () => {
    stubs.submit.mockResolvedValue(REGISTERED)
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user, "sw", "0754 000 111")
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))

    const [, sent] = stubs.submit.mock.calls[0] as [unknown, FormData]
    expect(sent.get("full_name")).toBe("Rehema Juma")
    expect(sent.get("phone")).toBe("0712 345 678")
    expect(sent.get("whatsapp")).toBe("0754 000 111")
    expect(sent.get("cf-turnstile-response")).toBe("fake-token")

    expect(await screen.findByRole("heading", { level: 1, name: "Code yako ya Punguzo" })).toHaveFocus()
    expect(screen.getByText("RJ-407")).toBeInTheDocument()
    expect(screen.getByText(REGISTERED.link)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Nakili kiungo" })).toBeInTheDocument()
    const share = screen.getByRole("link", { name: "Shiriki kwenye WhatsApp" })
    const href = share.getAttribute("href")!
    expect(href.startsWith("https://wa.me/?text=")).toBe(true)
    const text = decodeURIComponent(href.slice("https://wa.me/?text=".length))
    expect(text).toContain("RJ-407")
    expect(text.endsWith(REGISTERED.link)).toBe(true)
    expect(text).not.toMatch(FORBIDDEN)
    expect(screen.getByText(/shule itakapothibitisha code yako/)).toHaveTextContent(/Shule itawasiliana nawe/)
    expect(screen.getByRole("link", { name: "+255 700 000 001" })).toHaveAttribute("href", "tel:+255700000001")
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
    expect(stubs.reset).not.toHaveBeenCalled()
  })

  it("shows the English confirmation and share line in English", async () => {
    jar.values.set("lang", "en")
    stubs.submit.mockResolvedValue(REGISTERED)
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user, "en")
    await user.click(screen.getByRole("button", { name: WORDS.en.send }))

    expect(await screen.findByRole("heading", { level: 1, name: "Your Discount code" })).toBeInTheDocument()
    const href = screen.getByRole("link", { name: "Share on WhatsApp" }).getAttribute("href")!
    const text = decodeURIComponent(href.slice("https://wa.me/?text=".length))
    expect(text).toMatch(/Discount code RJ-407/)
    expect(text).not.toMatch(FORBIDDEN)
    expect(screen.getByText(/once the school confirms your code/)).toHaveTextContent(/The school will contact you/)
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
  })

  it("Copy puts the link on the clipboard and says so", async () => {
    stubs.submit.mockResolvedValue(REGISTERED)
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, "writeText")
    render(await DiscountCodePage())
    await fill(user)
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))
    await user.click(await screen.findByRole("button", { name: "Nakili kiungo" }))

    expect(write).toHaveBeenCalledWith(REGISTERED.link)
    expect(await screen.findByRole("button", { name: "Kiungo kimenakiliwa" })).toBeInTheDocument()
  })

  it.each([
    ["rate-limited", /Umejaribu mara nyingi mno/],
    ["check-failed", /Ukaguzi wa usalama haukukamilika/],
    ["unavailable", /Hatukuweza kukupatia code kwa sasa/],
  ])("on %s, says so, keeps the entries and resets the widget", async (status, text) => {
    stubs.submit.mockResolvedValue({ status })
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user, "sw", "0754 000 111")
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))

    expect(await screen.findByRole("alert")).toHaveTextContent(text)
    expect(stubs.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveValue("Rehema Juma")
    expect(screen.getByLabelText(WORDS.sw.phone, { exact: true })).toHaveValue("0712 345 678")
    expect(screen.getByLabelText(WORDS.sw.whatsapp)).toHaveValue("0754 000 111")
    expect(screen.getByRole("button", { name: WORDS.sw.send })).toBeEnabled()
  })

  it("treats a send that never answered as unavailable, keeping the entries", async () => {
    stubs.submit.mockRejectedValue(new Error("network dropped"))
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/Hatukuweza kukupatia code kwa sasa/)
    expect(stubs.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveValue("Rehema Juma")
  })

  it("puts the reader on a phone the server couldn't read, keeping the entries and resetting the widget", async () => {
    stubs.submit.mockResolvedValue({ status: "invalid", field: "phone" })
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))

    const phone = screen.getByLabelText(WORDS.sw.phone, { exact: true })
    await waitFor(() => expect(phone).toHaveFocus())
    expect(phone).toHaveAccessibleDescription(/Hatukuweza kusoma namba hii ya simu/)
    expect(phone).toHaveValue("0712 345 678")
    expect(stubs.reset).toHaveBeenCalledTimes(1)
  })
})
