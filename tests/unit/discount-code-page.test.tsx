import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef, useImperativeHandle } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const jar = vi.hoisted(() => ({ values: new Map<string, string>() }))
const stubs = vi.hoisted(() => ({ submit: vi.fn(), reset: vi.fn(), reveal: vi.fn(() => false), token: "fake-token", client: vi.fn(), discount: vi.fn() }))

vi.mock("@/lib/office", () => ({ OFFICE_PHONE: "+255 700 000 001" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
  }),
}))
// The page reads only the interview discount, through the secret-key client,
// and must still render when that read fails. A staff session is never read.
vi.mock("server-only", () => ({}))
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => {
    throw new Error("the Discount code page must not read a staff session")
  },
}))
vi.mock("@/utils/supabase/public-form", () => ({ publicFormClient: () => stubs.client() }))
vi.mock("@/lib/services/referral", () => ({ getInterviewDiscount: (...args: unknown[]) => stubs.discount(...args) }))
vi.mock("@/app/discount-code/actions", () => ({ registerAsAgent: stubs.submit }))
vi.mock("@/app/actions/language", () => ({ setLanguage: vi.fn() }))
vi.mock("@/components/turnstile-widget", () => ({
  TurnstileWidget: forwardRef(function FakeTurnstile({ action }: { action: string }, ref) {
    useImperativeHandle(ref, () => ({ reset: stubs.reset, reveal: stubs.reveal }))
    return <input type="hidden" name="cf-turnstile-response" value={stubs.token} data-action={action} readOnly />
  }),
}))

import DiscountCodePage, { generateMetadata } from "@/app/discount-code/page"

// Words public pages never use (CONTEXT.md, Discount code).
const FORBIDDEN = /agent|referral|approv|wakala|idhini/i

const WORDS = {
  sw: {
    name: "Jina lako kamili",
    phone: "Namba ya simu",
    whatsapp: "Namba ya WhatsApp (si lazima)",
    email: "Barua pepe",
    hasCode: "Tayari una code?",
    code: "Code yako ya Punguzo",
    send: "Pata Code ya Punguzo",
  },
  en: {
    name: "Your full name",
    phone: "Phone number",
    whatsapp: "WhatsApp number (optional)",
    email: "Email",
    hasCode: "Already have a Discount code?",
    code: "Your Discount code",
    send: "Get my Discount code",
  },
} as const

const REGISTERED = {
  status: "registered",
  code: "RJ-407",
  link: "https://alrahmah.example/apply?ref=RJ-407",
  email: "rehema@example.test",
}

beforeEach(() => {
  jar.values.clear()
  stubs.submit.mockReset()
  stubs.reset.mockReset()
  stubs.reveal.mockReset().mockReturnValue(false)
  stubs.token = "fake-token"
  stubs.client.mockReset().mockReturnValue({ secret: "client" })
  stubs.discount.mockReset().mockResolvedValue({ ok: true, data: 10000 })
})

async function fill(user: ReturnType<typeof userEvent.setup>, lang: "sw" | "en" = "sw", whatsapp = "") {
  const t = WORDS[lang]
  await user.type(screen.getByLabelText(t.name), "Rehema Juma")
  await user.type(screen.getByLabelText(t.phone, { exact: true }), "0712 345 678")
  if (whatsapp) await user.type(screen.getByLabelText(t.whatsapp), whatsapp)
  await user.type(screen.getByLabelText(t.email), "rehema@example.test")
}

describe("the Discount code page", { timeout: 20_000 }, () => {
  it("is kept out of search engines", async () => {
    expect(await generateMetadata()).toEqual(
      expect.objectContaining({ title: "Code ya Punguzo · Al-Rahmah Complex", robots: { index: false, follow: false } }),
    )
  })

  it("renders in Swahili by default and offers the database's discount once the school confirms", async () => {
    render(await DiscountCodePage())

    expect(stubs.discount).toHaveBeenCalledWith({ secret: "client" })
    expect(screen.getByRole("main")).toHaveAttribute("lang", "sw")
    expect(screen.getByRole("heading", { level: 1, name: "Pata Code ya Punguzo" })).toBeInTheDocument()
    expect(screen.getByText(/TZS 10,000/)).toHaveTextContent(/ada ya usaili/)
    expect(screen.getByText(/TZS 10,000/)).toHaveTextContent(/shule itakapothibitisha/)
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument()
    expect(document.querySelector('input[name="cf-turnstile-response"]')).toHaveAttribute("data-action", "agent")
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
  })

  it("renders in English when the language cookie says so", async () => {
    jar.values.set("lang", "en")
    render(await DiscountCodePage())

    expect(screen.getByRole("main")).toHaveAttribute("lang", "en")
    expect(screen.getByRole("heading", { level: 1, name: "Get a Discount code" })).toBeInTheDocument()
    expect(screen.getByText(/TZS 10,000/)).toHaveTextContent(/interview fee once the school confirms/)
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
    jar.values.set("lang", "en")
    expect(await generateMetadata()).toEqual(expect.objectContaining({ title: "Discount code · Al-Rahmah Complex" }))
  })

  it.each([
    ["the secret key is missing", () => stubs.client.mockReturnValue(null)],
    ["the client can't be made", () => stubs.client.mockImplementation(() => { throw new Error("no url") })],
    ["the read fails", () => stubs.discount.mockResolvedValue({ ok: false, error: "unavailable" })],
    ["the read throws", () => stubs.discount.mockRejectedValue(new Error("fetch failed"))],
  ])("still renders, naming no figure, when %s", async (_, breakIt) => {
    breakIt()
    render(await DiscountCodePage())
    expect(screen.getByText(/punguzo kwenye ada ya usaili, shule itakapothibitisha/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/TZS/)

    jar.values.set("lang", "en")
    render(await DiscountCodePage())
    expect(screen.getByText(/get a discount on the interview fee once the school confirms/)).toBeInTheDocument()
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
    expect(sent.get("email")).toBe("rehema@example.test")
    expect(sent.get("has_code")).toBe("no")

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
    expect(screen.getByText(/shule itakapothibitisha code yako\. Shule/)).toHaveTextContent(/Shule itawasiliana nawe/)
    expect(screen.getByText(/barua pepe ya kuweka nenosiri kwenye rehema@example\.test/)).toHaveTextContent(/angalia spam/)
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
    expect(screen.getByText(/once the school confirms your code\. The school/)).toHaveTextContent(/The school will contact you/)
    expect(screen.getByText(/email at rehema@example\.test to set your password/)).toBeInTheDocument()
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

  it("keeps the code box and the sign-in prompt apart, and links the sign-in page", async () => {
    render(await DiscountCodePage())
    expect(screen.getByRole("checkbox", { name: WORDS.sw.hasCode })).toHaveAccessibleDescription(
      "Una code lakini bado hujapokea barua pepe ya kuweka nenosiri? Weka alama hapa",
    )
    expect(screen.getByText("Umeshaweka nenosiri?")).toContainElement(screen.getByRole("link", { name: "Ingia" }))
    expect(screen.getByRole("link", { name: "Ingia" })).toHaveAttribute("href", "/login")
  })

  it("names a missing email, and a missing code once the box is ticked", async () => {
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await user.type(screen.getByLabelText(WORDS.sw.name), "Rehema Juma")
    await user.type(screen.getByLabelText(WORDS.sw.phone, { exact: true }), "0712 345 678")
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))
    expect(screen.getByLabelText(WORDS.sw.email)).toHaveAccessibleDescription(/Andika barua pepe yako/)

    await user.type(screen.getByLabelText(WORDS.sw.email), "rehema@example.test")
    await user.click(screen.getByRole("checkbox", { name: WORDS.sw.hasCode }))
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))
    expect(screen.getByLabelText(WORDS.sw.code)).toHaveAccessibleDescription(/Andika Code yako ya Punguzo/)
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("sends a claim with the box and the code, then shows the claimed code and says to check spam", async () => {
    stubs.submit.mockResolvedValue({ status: "claimed", code: "RJ-407", link: REGISTERED.link })
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await user.click(screen.getByRole("checkbox", { name: WORDS.sw.hasCode }))
    await user.type(screen.getByLabelText(WORDS.sw.code), "rj-407")
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))

    const [, sent] = stubs.submit.mock.calls[0] as [unknown, FormData]
    expect(sent.get("has_code")).toBe("yes")
    expect(sent.get("code")).toBe("rj-407")
    expect(await screen.findByRole("heading", { level: 1, name: "Code yako ya Punguzo" })).toHaveFocus()
    expect(screen.getByText("RJ-407")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Shiriki kwenye WhatsApp" })).toBeInTheDocument()
    expect(screen.getByText(/Shule itathibitisha barua pepe yako/)).toHaveTextContent(/angalia spam/)
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
  })

  it.each([
    ["code-needed", "Namba hii tayari ina Code ya Punguzo. Weka alama kwenye 'Tayari una code?' na uiandike, au piga simu ofisini.", /This number already has a Discount code/],
    ["phone-mismatch", "Hatukuweza kulinganisha code na namba hii. Zihakiki, au piga simu ofisini.", /couldn't match the code with this number/],
    ["no-match", "Hatukupata code hii. Ihakiki, au piga simu ofisini.", /couldn't find this code/],
    ["claim-waiting", "Tumepokea ombi lako; shule itathibitisha.", /the school will confirm it/],
    ["invited", "Tumekutumia barua pepe. Angalia spam, au tumia 'Tuma kiungo kipya'.", /Check spam, or use 'Send a new link'/],
    ["joined", "Tayari una akaunti. Ingia.", /You already have an account/],
    ["email-unusable", "Barua pepe hii haiwezi kutumika. Tumia nyingine au piga simu ofisini.", /This email can't be used/],
    ["access-off", "Huduma hii imesimamishwa kwa muda.", /paused for now/],
  ])("on %s, shows its own message in Swahili and English, keeping the entries", async (status, swahili, english) => {
    stubs.submit.mockResolvedValue({ status })
    const user = userEvent.setup()
    const first = render(await DiscountCodePage())
    await fill(user)
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))
    expect(await screen.findByRole("alert")).toHaveTextContent(swahili)
    expect(screen.getByLabelText(WORDS.sw.email)).toHaveValue("rehema@example.test")
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
    first.unmount()

    jar.values.set("lang", "en")
    render(await DiscountCodePage())
    await fill(user, "en")
    await user.click(screen.getByRole("button", { name: WORDS.en.send }))
    expect(await screen.findByRole("alert")).toHaveTextContent(english)
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
  })

  it("on joined, links the sign-in page from the message", async () => {
    stubs.submit.mockResolvedValue({ status: "joined" })
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))
    const alert = await screen.findByRole("alert")
    expect(alert.querySelector('a[href="/login"]')).toHaveTextContent("Ingia")
  })
})
