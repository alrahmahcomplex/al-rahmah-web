import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef, useImperativeHandle, type ImgHTMLAttributes } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const jar = vi.hoisted(() => ({ values: new Map<string, string>() }))
const stubs = vi.hoisted(() => ({ submit: vi.fn(), reset: vi.fn(), reveal: vi.fn(() => false), token: "fake-token", client: vi.fn(), discount: vi.fn() }))

vi.mock("@/lib/office", () => ({ OFFICE_PHONE: "+255 700 000 001" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
    has: (name: string) => jar.values.has(name),
  }),
}))
vi.mock("next/image", () => ({
  default: ({ priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    void priority
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />
  },
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
    name: "Unaitwa nani?",
    phone: "Namba yako ya simu?",
    whatsappToggle: "Namba yangu ya WhatsApp ni tofauti",
    whatsapp: "Namba ya WhatsApp (si lazima)",
    email: "Barua pepe yako?",
    yes: "Ndiyo",
    no: "Hapana",
    code: "Code yako ya Punguzo",
    next: "Endelea",
    send: "Pata Code ya Punguzo",
  },
  en: {
    name: "What's your name?",
    phone: "Your phone number?",
    whatsappToggle: "My WhatsApp number is different",
    whatsapp: "WhatsApp number (optional)",
    email: "Your email?",
    yes: "Yes",
    no: "No",
    code: "Your Discount code",
    next: "Continue",
    send: "Get my Discount code",
  },
} as const

type Lang = keyof typeof WORDS
type User = ReturnType<typeof userEvent.setup>

const REGISTERED = {
  status: "registered",
  code: "RJ-407",
  link: "https://alrahmah.example/apply?ref=RJ-407",
  email: "rehema@example.test",
}

beforeEach(() => {
  jar.values.clear()
  // The first-visit language card has its own tests; these pages have a language.
  jar.values.set("lang", "sw")
  stubs.submit.mockReset()
  stubs.reset.mockReset()
  stubs.reveal.mockReset().mockReturnValue(false)
  stubs.token = "fake-token"
  stubs.client.mockReset().mockReturnValue({ secret: "client" })
  stubs.discount.mockReset().mockResolvedValue({ ok: true, data: 10000 })
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})

// The open question: the only step whose controls can be used.
function openStep() {
  const step = document.querySelector<HTMLElement>('li[data-state="open"]')
  if (!step) throw new Error("no open step")
  return within(step)
}

async function next(user: User, lang: Lang = "sw") {
  await user.click(openStep().getByRole("button", { name: WORDS[lang].next }))
}

// Walks every question up to the send step. `code`: answer "Tayari una code?"
// with Ndiyo and this code; otherwise Hapana.
async function fill(user: User, lang: Lang = "sw", { whatsapp = "", code = "" } = {}) {
  const t = WORDS[lang]
  await user.type(screen.getByLabelText(t.name), "Rehema Juma")
  await next(user, lang)
  await user.type(screen.getByLabelText(t.phone), "0712 345 678")
  if (whatsapp) {
    await user.click(screen.getByRole("button", { name: t.whatsappToggle }))
    await user.type(screen.getByLabelText(t.whatsapp), whatsapp)
  }
  await next(user, lang)
  await user.type(screen.getByLabelText(t.email), "rehema@example.test")
  await next(user, lang)
  if (code) {
    await user.click(screen.getByRole("radio", { name: t.yes }))
    await user.type(screen.getByLabelText(t.code), code)
  } else {
    await user.click(screen.getByRole("radio", { name: t.no }))
  }
  await next(user, lang)
}

async function send(user: User, lang: Lang = "sw") {
  await user.click(screen.getByRole("button", { name: WORDS[lang].send }))
}

describe("the Discount code page", { timeout: 30_000 }, () => {
  it("is kept out of search engines", async () => {
    expect(await generateMetadata()).toEqual(
      expect.objectContaining({ title: "Code ya Punguzo · Al-Rahmah Complex", robots: { index: false, follow: false } }),
    )
  })

  it("renders in Swahili under the COMPLEX top bar, one question at a time, with the database's discount", async () => {
    render(await DiscountCodePage())

    expect(stubs.discount).toHaveBeenCalledWith({ secret: "client" })
    expect(screen.getByRole("main")).toHaveAttribute("lang", "sw")
    expect(screen.getByText("AL-RAHMAH COMPLEX")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Al-Rahmah: ukurasa wa nyumbani" })).toHaveAttribute("href", "https://alrahmahcomplex.or.tz/")
    expect(screen.getByRole("heading", { level: 1, name: "Code ya Punguzo" })).toHaveClass("sr-only")
    expect(screen.getByRole("button", { name: "Menyu" })).toBeInTheDocument()
    expect(screen.getByText(/TZS 10,000/)).toHaveTextContent(/ada ya usaili/)
    expect(screen.getByText(/TZS 10,000/)).toHaveTextContent(/shule itakapothibitisha/)
    expect(openStep().getByRole("heading", { name: WORDS.sw.name })).toBeInTheDocument()
    expect(screen.queryByLabelText(WORDS.sw.phone)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: WORDS.sw.send })).not.toBeInTheDocument()
    // The security check waits for the send step.
    expect(document.querySelector('input[name="cf-turnstile-response"]')).toBeNull()
    expect(screen.queryByText("Karibu!")).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
  })

  it("renders in English when the language cookie says so", async () => {
    jar.values.set("lang", "en")
    render(await DiscountCodePage())

    expect(screen.getByRole("main")).toHaveAttribute("lang", "en")
    expect(screen.getByRole("heading", { level: 1, name: "Discount code" })).toBeInTheDocument()
    expect(screen.getByLabelText(WORDS.en.name)).toBeInTheDocument()
    expect(screen.getByText(/TZS 10,000/)).toHaveTextContent(/interview fee once the school confirms/)
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
    expect(await generateMetadata()).toEqual(expect.objectContaining({ title: "Discount code · Al-Rahmah Complex" }))
  })

  it("shows the first-visit language card when the request has no language cookie", async () => {
    jar.values.clear()
    render(await DiscountCodePage())
    expect(screen.getByText("Karibu!")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Endelea kwa Kiswahili" })).toBeInTheDocument()
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

  it("names a missing name or phone on its own question, and folds an answer with its Badilisha link", async () => {
    const user = userEvent.setup()
    render(await DiscountCodePage())

    await next(user)
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveAccessibleDescription(/Andika jina lako kamili/)
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveFocus()
    expect(screen.queryByLabelText(WORDS.sw.phone)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(WORDS.sw.name), "Rehema Juma")
    await next(user)
    expect(screen.getByLabelText(WORDS.sw.phone)).toHaveFocus()
    expect(screen.getByLabelText(WORDS.sw.phone)).toHaveAccessibleDescription("Mfano: 0712 345 678")
    expect(screen.getByText("Jina lako kamili")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Badilisha Jina" })).toBeInTheDocument()

    await next(user)
    expect(screen.getByLabelText(WORDS.sw.phone)).toHaveAccessibleDescription(/Andika namba yako ya simu/)
    expect(screen.queryByLabelText(WORDS.sw.email)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Badilisha Jina" }))
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveFocus()
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveValue("Rehema Juma")
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("asks for WhatsApp only behind its toggle, and sends none while the toggle is off", async () => {
    const user = userEvent.setup()
    stubs.submit.mockResolvedValue(REGISTERED)
    render(await DiscountCodePage())
    await user.type(screen.getByLabelText(WORDS.sw.name), "Rehema Juma")
    await next(user)

    const toggle = screen.getByRole("button", { name: WORDS.sw.whatsappToggle })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByLabelText(WORDS.sw.whatsapp)).not.toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    await user.type(screen.getByLabelText(WORDS.sw.whatsapp), "0754 000 111")
    await user.click(toggle)
    expect(screen.queryByLabelText(WORDS.sw.whatsapp)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(WORDS.sw.phone), "0712 345 678")
    await next(user)
    await user.type(screen.getByLabelText(WORDS.sw.email), "rehema@example.test")
    await next(user)
    await user.click(screen.getByRole("radio", { name: WORDS.sw.no }))
    await next(user)
    await send(user)

    const [, sent] = stubs.submit.mock.calls[0] as [unknown, FormData]
    expect(sent.get("whatsapp")).toBe("")
  })

  it("asks 'Tayari una code?' as two tiles: Ndiyo makes the code required, Hapana leaves it optional", async () => {
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await user.type(screen.getByLabelText(WORDS.sw.name), "Rehema Juma")
    await next(user)
    await user.type(screen.getByLabelText(WORDS.sw.phone), "0712 345 678")
    await next(user)
    await next(user)
    expect(screen.getByLabelText(WORDS.sw.email)).toHaveAccessibleDescription(/Andika barua pepe yako/)
    await user.type(screen.getByLabelText(WORDS.sw.email), "rehema@example.test")
    await next(user)

    const tiles = screen.getByRole("group", { name: "Tayari una code?" })
    expect(within(tiles).getByRole("radio", { name: "Ndiyo" })).toHaveAccessibleDescription(
      "Una code lakini bado hujapokea barua pepe ya kuweka nenosiri? Chagua Ndiyo.",
    )
    // Nothing to fill until a tile is picked.
    expect(screen.queryByLabelText(/Code yako ya Punguzo/)).not.toBeInTheDocument()

    await user.click(screen.getByRole("radio", { name: WORDS.sw.yes }))
    expect(screen.getByLabelText(WORDS.sw.code)).toBeInTheDocument()
    await next(user)
    expect(screen.getByLabelText(WORDS.sw.code)).toHaveAccessibleDescription(/Andika Code yako ya Punguzo/)
    expect(screen.queryByRole("button", { name: WORDS.sw.send })).not.toBeInTheDocument()

    await user.click(screen.getByRole("radio", { name: WORDS.sw.no }))
    expect(screen.getByLabelText("Code yako ya Punguzo (si lazima)")).toBeInTheDocument()
    await next(user)
    expect(screen.getByRole("button", { name: WORDS.sw.send })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Badilisha Code" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Badilisha Barua pepe" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Badilisha Namba" })).toBeInTheDocument()
    expect(document.querySelector('input[name="cf-turnstile-response"]')).toHaveAttribute("data-action", "agent")
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("waits for the security check before sending", async () => {
    stubs.token = ""
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await send(user)

    expect(screen.getByRole("alert")).toHaveTextContent(/Subiri ukaguzi wa usalama/)
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("lets a check that needs a click speak for itself, keeping the entries and sending nothing", async () => {
    stubs.token = ""
    stubs.reveal.mockReturnValue(true)
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await user.click(screen.getByRole("button", { name: WORDS.sw.send }))

    expect(stubs.reveal).toHaveBeenCalled()
    expect(screen.queryByText(/Subiri ukaguzi wa usalama/)).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveValue("Rehema Juma")
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("sends the entries and the token, then shows the code, the link, Copy, WhatsApp and the office phone", async () => {
    stubs.submit.mockResolvedValue(REGISTERED)
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user, "sw", { whatsapp: "0754 000 111" })
    await send(user)

    const [, sent] = stubs.submit.mock.calls[0] as [unknown, FormData]
    expect(sent.get("full_name")).toBe("Rehema Juma")
    expect(sent.get("phone")).toBe("0712 345 678")
    expect(sent.get("whatsapp")).toBe("0754 000 111")
    expect(sent.get("cf-turnstile-response")).toBe("fake-token")
    expect(sent.get("email")).toBe("rehema@example.test")
    expect(sent.get("has_code")).toBe("no")
    expect(sent.get("code")).toBe("")

    expect(await screen.findByRole("heading", { level: 1, name: "Code yako ya Punguzo" })).toHaveFocus()
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(screen.getByText("AL-RAHMAH COMPLEX")).toBeInTheDocument()
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
    await send(user, "en")

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
    await send(user)
    await user.click(await screen.findByRole("button", { name: "Nakili kiungo" }))

    expect(write).toHaveBeenCalledWith(REGISTERED.link)
    expect(await screen.findByRole("button", { name: "Kiungo kimenakiliwa" })).toBeInTheDocument()
  })

  it.each([
    ["rate-limited", /Umejaribu mara nyingi mno/],
    ["check-failed", /Ukaguzi wa usalama haukukamilika/],
    ["unavailable", /Hatukuweza kukupatia code kwa sasa/],
  ])("on %s, says so under the send step, keeps the entries and resets the widget", async (status, text) => {
    stubs.submit.mockResolvedValue({ status })
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user, "sw", { whatsapp: "0754 000 111" })
    await send(user)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(text)
    expect(openStep().getByRole("alert")).toBe(alert)
    expect(await screen.findByRole("button", { name: WORDS.sw.send })).toBeEnabled()
    expect(stubs.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveValue("Rehema Juma")
    expect(screen.getByLabelText(WORDS.sw.phone)).toHaveValue("0712 345 678")
    expect(screen.getByLabelText(WORDS.sw.whatsapp)).toHaveValue("0754 000 111")
  })

  it("treats a send that never answered as unavailable, keeping the entries", async () => {
    stubs.submit.mockRejectedValue(new Error("network dropped"))
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await send(user)

    expect(await screen.findByRole("alert")).toHaveTextContent(/Hatukuweza kukupatia code kwa sasa/)
    expect(stubs.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveValue("Rehema Juma")
  })

  it("reopens the phone question when the server couldn't read it, keeping the entries and resetting the widget", async () => {
    stubs.submit.mockResolvedValue({ status: "invalid", field: "phone" })
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await send(user)

    const phone = screen.getByLabelText(WORDS.sw.phone)
    await waitFor(() => expect(phone).toHaveFocus())
    expect(openStep().getByLabelText(WORDS.sw.phone)).toBe(phone)
    expect(phone).toHaveAccessibleDescription(/Hatukuweza kusoma namba hii ya simu/)
    expect(phone).toHaveValue("0712 345 678")
    expect(stubs.reset).toHaveBeenCalledTimes(1)

    // Fixed, it goes straight back to the send step.
    await next(user)
    expect(screen.getByRole("button", { name: WORDS.sw.send })).toBeInTheDocument()
  })

  it("keeps the code question and the sign-in prompt apart, and links the sign-in page", async () => {
    render(await DiscountCodePage())
    expect(screen.getByText("Umeshaweka nenosiri?")).toContainElement(screen.getByRole("link", { name: "Ingia" }))
    expect(screen.getByRole("link", { name: "Ingia" })).toHaveAttribute("href", "/login")
  })

  it("sends a claim with Ndiyo and the code, then shows the claimed code and says to check spam", async () => {
    stubs.submit.mockResolvedValue({ status: "claimed", code: "RJ-407", link: REGISTERED.link })
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user, "sw", { code: "rj-407" })
    expect(screen.getByText("Ndiyo · rj-407")).toBeInTheDocument()
    await send(user)

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
    await send(user)
    expect(await screen.findByRole("alert")).toHaveTextContent(swahili)
    expect(screen.getByLabelText(WORDS.sw.email)).toHaveValue("rehema@example.test")
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
    first.unmount()

    jar.values.set("lang", "en")
    render(await DiscountCodePage())
    await fill(user, "en")
    await send(user, "en")
    expect(await screen.findByRole("alert")).toHaveTextContent(english)
    expect(document.body.textContent).not.toMatch(FORBIDDEN)
  })

  it("on joined, links the sign-in page from the message", async () => {
    stubs.submit.mockResolvedValue({ status: "joined" })
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await fill(user)
    await send(user)
    const alert = await screen.findByRole("alert")
    expect(alert.querySelector('a[href="/login"]')).toHaveTextContent("Ingia")
  })

  it("the menu's 'Futa fomu yote' asks first, then clears every answer back to the first question", async () => {
    const user = userEvent.setup()
    render(await DiscountCodePage())
    await user.type(screen.getByLabelText(WORDS.sw.name), "Rehema Juma")
    await next(user)
    await user.type(screen.getByLabelText(WORDS.sw.phone), "0712 345 678")

    await user.click(screen.getByRole("button", { name: "Menyu" }))
    await user.click(screen.getByRole("button", { name: "Futa fomu yote" }))
    expect(screen.getByText("Futa majibu yote?")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Hapana" }))
    expect(screen.getByLabelText(WORDS.sw.phone)).toHaveValue("0712 345 678")

    await user.click(screen.getByRole("button", { name: "Futa fomu yote" }))
    await user.click(screen.getByRole("button", { name: "Ndiyo, futa" }))
    await waitFor(() => expect(screen.queryByLabelText(WORDS.sw.phone)).not.toBeInTheDocument())
    expect(screen.getByLabelText(WORDS.sw.name)).toHaveValue("")
    expect(screen.queryByRole("button", { name: "Badilisha Jina" })).not.toBeInTheDocument()
  })
})
