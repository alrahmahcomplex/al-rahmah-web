import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef, useImperativeHandle, type ImgHTMLAttributes } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({ submit: vi.fn(), check: vi.fn(), reset: vi.fn(), reveal: vi.fn(() => false), refresh: vi.fn(), token: "fake-token" }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/office", () => ({ OFFICE_PHONE: "+255 700 000 001" }))
// The page is built once per language state and served to every visitor, so
// it reads nothing from the request: any read of the cookies fails this test.
vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("the Admission form page must not read the request")
  },
}))
// The form page must render with Supabase down: any use of a Supabase client
// fails this test.
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => {
    throw new Error("the Admission form must not read Supabase to render")
  },
}))
vi.mock("@/app/apply/actions", () => ({ submitAdmissionForm: stubs.submit, checkDiscountCode: stubs.check }))
vi.mock("@/app/actions/language", () => ({ setLanguage: vi.fn().mockResolvedValue(undefined) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stubs.refresh }) }))
vi.mock("next/image", () => ({
  default: ({ priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    void priority
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />
  },
}))
vi.mock("@/components/turnstile-widget", () => ({
  TurnstileWidget: forwardRef(function FakeTurnstile(_: unknown, ref) {
    useImperativeHandle(ref, () => ({ reset: stubs.reset, reveal: stubs.reveal }))
    return <input type="hidden" name="cf-turnstile-response" value={stubs.token} readOnly />
  }),
}))

import { AdmissionFormSteps } from "@/app/apply/admission-form"
import { DRAFT_KEY } from "@/app/apply/draft"
import ApplyPage, { generateStaticParams } from "@/app/by-language/[state]/apply/page"
import { admissionYears } from "@/lib/admission-form"
import { FORM_NOTICE, FORM_NOTICE_VERSION } from "@/lib/referral-notice"

const years = admissionYears()
const DEFAULT_YEAR = years[1]
type User = ReturnType<typeof userEvent.setup>

// The live figures the form reads from /api/apply/live.
let live: { applications: number | null; discount: number | null } = { applications: null, discount: null }

beforeEach(() => {
  document.cookie = "discount_code=; Max-Age=0; Path=/"
  // Each test opens a fresh tab: no draft, and no question in the URL.
  window.sessionStorage.clear()
  window.history.replaceState(null, "", "/apply")
  // Folds and taps answer at once, with no animation to wait for.
  document.documentElement.classList.add("rm")
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  live = { applications: null, discount: null }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(live), { headers: { "content-type": "application/json" } })),
  )
  stubs.submit.mockReset()
  stubs.check.mockReset()
  stubs.reset.mockReset()
  stubs.reveal.mockReset().mockReturnValue(false)
  stubs.refresh.mockReset()
  stubs.token = "fake-token"
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.classList.remove("rm")
})

const W = {
  sw: {
    name: "Mwanafunzi anaitwa nani?",
    other: "Chagua darasa lingine",
    day: "Kutwa",
    no: "Hapana, endelea",
    yes: "Ndiyo, ongeza mwanafunzi",
    pname: "Jina lako kamili ni nani?",
    mother: "Mama",
    phone: "Namba yako ya simu ni ipi?",
    next: "Endelea",
    skip: "Ruka, sina code",
    send: "Tuma maombi",
  },
  en: {
    name: "What is the student's name?",
    other: "Choose another class",
    day: "Day",
    no: "No, continue",
    yes: "Yes, add a student",
    pname: "What is your full name?",
    mother: "Mother",
    phone: "What is your phone number?",
    next: "Continue",
    skip: "Skip, no code",
    send: "Send application",
  },
} as const

/** The question open now. */
function open() {
  const li = document.querySelector<HTMLElement>('li[data-state="open"]')
  if (!li) throw new Error("no question is open")
  return within(li)
}

async function waitForQuestion(name: string | RegExp) {
  await waitFor(() => expect(open().getByRole("heading", { name })).toBeInTheDocument())
}

async function pickClass(user: User, className: string, lang: "sw" | "en") {
  await user.click(open().getByRole("button", { name: W[lang].other }))
  const sheet = await screen.findByRole("dialog")
  await user.click(within(sheet).getByRole("button", { name: className }))
}

async function answerStudent(user: User, name: string, lang: "sw" | "en", { className = "STD 2", day = true } = {}) {
  await user.type(open().getByRole("textbox"), name)
  await user.click(open().getByRole("button", { name: W[lang].next }))
  await pickClass(user, className, lang)
  await waitFor(() => expect(open().getByRole("radio", { name: new RegExp(W[lang].day) })).toBeInTheDocument())
  if (day) await user.click(open().getByRole("radio", { name: new RegExp(W[lang].day) }))
  else await user.click(open().getByRole("button", { name: W[lang].next }))
}

async function answerCustodian(user: User, lang: "sw" | "en") {
  await waitForQuestion(W[lang].pname)
  await user.type(open().getByRole("textbox"), "Amina Mfano")
  await user.click(open().getByRole("button", { name: W[lang].next }))
  await user.click(open().getByRole("radio", { name: W[lang].mother }))
  await waitForQuestion(W[lang].phone)
  await user.type(open().getByRole("textbox"), "0700 000 900")
  await user.click(open().getByRole("button", { name: W[lang].next }))
}

/** One student, no code, through to the send question. */
async function fillToSend(user: User, lang: "sw" | "en" = "en") {
  await answerStudent(user, "Zawadi Mfano", lang)
  await waitFor(() => expect(open().getByRole("button", { name: W[lang].no })).toBeInTheDocument())
  await user.click(open().getByRole("button", { name: W[lang].no }))
  await answerCustodian(user, lang)
  await user.click(open().getByRole("button", { name: W[lang].skip }))
  await user.click(open().getByRole("button", { name: W[lang].next }))
  await waitFor(() => expect(open().getByRole("button", { name: W[lang].send })).toBeInTheDocument())
}

/** Sends, once the send button is back from any earlier send. */
async function send(user: User, label: string) {
  const button = await waitFor(() => open().getByRole("button", { name: label }))
  await user.click(button)
}

function form(language: "sw" | "en" = "en", extra: Partial<Parameters<typeof AdmissionFormSteps>[0]> = {}) {
  return <AdmissionFormSteps language={language} years={years} defaultYear={DEFAULT_YEAR} officePhone="+255 700 000 001" {...extra} />
}

// The page opened from a Referral link: `/apply?ref=<code>`.
function openedFromLink(code: string) {
  window.history.replaceState(null, "", `/apply?ref=${code}`)
}

// The code the browser remembers from an earlier link.
function remembered(code: string) {
  document.cookie = `discount_code=${code}; Path=/`
}

function renderPage(state: "first" | "sw" | "en") {
  return ApplyPage({ params: Promise.resolve({ state }) })
}

function sentBody(call = 0) {
  const [, data] = stubs.submit.mock.calls[call] as [unknown, FormData]
  return JSON.parse(String(data.get("form")))
}

// Each test walks a whole form, which takes seconds on a loaded machine.
describe("the Admission form page", { timeout: 30_000 }, () => {
  it("renders in Swahili by default under the brand top bar, reading no Supabase", async () => {
    render(await renderPage("first"))

    expect(screen.getByRole("main")).toHaveAttribute("lang", "sw")
    expect(screen.getByText("AL-RAHMAH SCHOOLS")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: "Fomu ya Udahili" })).toHaveClass("sr-only")
    expect(screen.getByRole("button", { name: "Menyu" })).toBeInTheDocument()
    expect(open().getByRole("heading", { name: "Mwanafunzi anaitwa nani?" })).toBeInTheDocument()
    expect(screen.getByText("Kama lilivyo kwenye cheti cha kuzaliwa.")).toBeInTheDocument()
    // No language cookie yet: the first-visit card asks.
    expect(screen.getByText("Karibu!")).toBeInTheDocument()
    // One question only, and no step counter or language switch on the page.
    expect(document.querySelectorAll("li.gf-step")).toHaveLength(1)
    expect(screen.queryByText(/Hatua \d kati ya/)).not.toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Lugha" })).not.toBeInTheDocument()
  })

  it("renders in English when the language cookie says so, without the language card", async () => {
    render(await renderPage("en"))

    expect(screen.getByRole("main")).toHaveAttribute("lang", "en")
    expect(screen.getByRole("heading", { level: 1, name: "Admission Form" })).toBeInTheDocument()
    expect(open().getByRole("heading", { name: "What is the student's name?" })).toBeInTheDocument()
    expect(screen.queryByText("Karibu!")).not.toBeInTheDocument()
  })

  it("renders in Swahili without the language card for any other language cookie", async () => {
    render(await renderPage("sw"))

    expect(screen.getByRole("main")).toHaveAttribute("lang", "sw")
    expect(open().getByRole("heading", { name: "Mwanafunzi anaitwa nani?" })).toBeInTheDocument()
    expect(screen.queryByText("Karibu!")).not.toBeInTheDocument()
  })

  it("is built once per language state", () => {
    expect(generateStaticParams()).toEqual([{ state: "first" }, { state: "sw" }, { state: "en" }])
  })

  it.each(["first", "sw", "en"] as const)("holds no Discount code in the %s copy, whatever the link or cookie", async (state) => {
    openedFromLink("BJN-402")
    remembered("ZERO26")
    const page = await renderPage(state)
    const { renderToString } = await import("react-dom/server")
    const html = renderToString(page)
    expect(html).not.toContain("BJN-402")
    expect(html).not.toContain("ZERO26")
  })

  it("asks one question at a time in the prototype's order, folding each answer with a two-word Change link", async () => {
    const user = userEvent.setup()
    render(form("sw"))

    await user.type(open().getByRole("textbox"), "Neema Mfano")
    await user.click(open().getByRole("button", { name: "Endelea" }))
    await waitForQuestion("Neema anaomba darasa gani?")
    expect(screen.getByRole("heading", { level: 3, name: "Mwanafunzi" })).toBeInTheDocument()
    expect(screen.getByText("Jina kamili la mwanafunzi")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Badilisha Jina" })).toBeInTheDocument()
    expect(open().getByText("Wazazi wengi huchagua")).toBeInTheDocument()
    expect(open().getByText(String(DEFAULT_YEAR))).toBeInTheDocument()

    await user.click(open().getByRole("button", { name: /FORM 1/ }))
    await waitForQuestion("Neema atakuwa wa kutwa au bweni?")
    expect(screen.getByText(`FORM 1 · ${DEFAULT_YEAR}`)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Badilisha Darasa" })).toBeInTheDocument()

    await user.click(open().getByRole("radio", { name: /Bweni/ }))
    await waitForQuestion("Unaomba kwa mwanafunzi mwingine pia?")
    // The student folds into one line once their three answers are in.
    const buttons = open().getAllByRole("button").map((b) => b.textContent)
    expect(buttons).toEqual(["Ndiyo, ongeza mwanafunzi", "Hapana, endelea"])

    await user.click(open().getByRole("button", { name: "Hapana, endelea" }))
    await waitForQuestion("Jina lako kamili ni nani?")
    expect(screen.getByRole("heading", { level: 3, name: "Msimamizi" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Badilisha Taarifa, Neema Mfano" })).toBeInTheDocument()
    await user.type(open().getByRole("textbox"), "Asha Mfano")
    await user.click(open().getByRole("button", { name: "Endelea" }))
    await waitForQuestion("Wewe ni nani kwa Neema?")
    expect(open().getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["Mama", "Baba", "Mlezi", "Mwingine"])
    await user.click(open().getByRole("radio", { name: "Mama" }))
    await waitForQuestion("Namba yako ya simu ni ipi?")
    await user.type(open().getByRole("textbox"), "0712 345 678")
    await user.click(open().getByRole("button", { name: "Namba yangu ya WhatsApp ni tofauti" }))
    await user.type(screen.getByLabelText(/Namba ya WhatsApp/), "0754 000 111")
    await user.click(open().getByRole("button", { name: "Endelea" }))

    await waitForQuestion("Una code ya punguzo?")
    expect(screen.getByRole("heading", { level: 3, name: "Usaili" })).toBeInTheDocument()
    expect(screen.getByText("WhatsApp 0754 000 111")).toBeInTheDocument()
    for (const link of ["Badilisha Uhusiano", "Badilisha Namba"]) expect(screen.getByRole("button", { name: link })).toBeInTheDocument()
    expect(open().getByText("TZS 50,000")).toBeInTheDocument()
    expect(open().getByRole("button", { name: "Hakiki Punguzo" })).toBeInTheDocument()
    await user.click(open().getByRole("button", { name: "Ruka, sina code" }))

    await waitForQuestion("Ada ya usaili")
    expect(screen.getByText("Hakuna code")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Badilisha Code" })).toBeInTheDocument()
    await user.click(open().getByRole("button", { name: "Endelea" }))
    await waitForQuestion("Hakiki kisha utume")
    expect(open().getByRole("button", { name: "Tuma maombi" })).toHaveAttribute("type", "submit")
  })

  it("reopens a folded answer, folds it again on Continue and returns to the first unanswered question", async () => {
    const user = userEvent.setup()
    render(form("en"))
    await answerStudent(user, "Zawadi Mfano", "en")
    await user.click(open().getByRole("button", { name: "No, continue" }))
    await waitForQuestion("What is your full name?")

    await user.click(screen.getByRole("button", { name: "Change Details, Zawadi Mfano" }))
    await user.click(screen.getByRole("button", { name: "Change Name" }))
    await waitForQuestion("What is the student's name?")
    const field = open().getByRole("textbox")
    expect(field).toHaveFocus()
    await user.clear(field)
    await user.type(field, "Zawadi Juma")
    await user.click(open().getByRole("button", { name: "Continue" }))
    await waitForQuestion("What is your full name?")
    expect(screen.getByText(/Zawadi Juma/)).toBeInTheDocument()
  })

  it("Back opens the question before, and Start over shows only on the first, empty question", async () => {
    const user = userEvent.setup()
    render(form("en"))
    expect(screen.getByRole("button", { name: "Start over" })).toBeInTheDocument()
    expect(document.querySelector('button[aria-label="Back"]')).toHaveAttribute("aria-hidden", "true")

    await user.type(open().getByRole("textbox"), "Zawadi Mfano")
    await user.click(open().getByRole("button", { name: "Continue" }))
    await waitForQuestion("Which class is Zawadi applying for?")
    await user.click(screen.getByRole("button", { name: "Back" }))
    await waitForQuestion("What is the student's name?")
    expect(open().getByRole("textbox")).toHaveValue("Zawadi Mfano")
    expect(document.querySelector('button[aria-label="Start over"]')).toHaveAttribute("aria-hidden", "true")
  })

  it("Start over and the menu's Clear the whole form empty the form and its draft", async () => {
    const user = userEvent.setup()
    render(form("en"))
    await user.type(open().getByRole("textbox"), "Zawadi Mfano")
    await waitFor(() => expect(window.sessionStorage.length).toBe(1))

    await user.click(screen.getByRole("button", { name: "Menu" }))
    await user.click(screen.getByRole("button", { name: "Clear the whole form" }))
    await user.click(screen.getByRole("button", { name: "Yes, clear" }))
    await waitFor(() => expect(open().getByRole("textbox")).toHaveValue(""))
    expect(window.sessionStorage.length).toBe(0)
    await waitFor(() => expect(screen.getByText("The form is cleared. Start again.")).toBeInTheDocument())
  })

  it("names the missing name under the field, and Other asks for a description", async () => {
    const user = userEvent.setup()
    render(form("en"))

    await user.click(open().getByRole("button", { name: "Continue" }))
    expect(open().getByText("Enter the student's full name.")).toBeInTheDocument()
    await waitFor(() => expect(open().getByRole("textbox")).toHaveFocus())
    await user.type(open().getByRole("textbox"), "Zawadi Mfano")
    expect(screen.queryByText("Enter the student's full name.")).not.toBeInTheDocument()
    await user.click(open().getByRole("button", { name: "Continue" }))
    await pickClass(user, "STD 2", "en")
    await waitForQuestion(/day scholar/)
    await user.click(open().getByRole("button", { name: "Continue" }))
    // Nothing picked and no student before to copy: the choice is asked for.
    expect(open().getByText("Choose day or boarding.")).toBeInTheDocument()
    await user.click(open().getByRole("radio", { name: /Day/ }))
    await user.click(await screen.findByRole("button", { name: "No, continue" }))
    await waitForQuestion("What is your full name?")
    await user.type(open().getByRole("textbox"), "Amina Mfano")
    await user.click(open().getByRole("button", { name: "Continue" }))
    await user.click(open().getByRole("radio", { name: "Other" }))
    await user.click(open().getByRole("button", { name: "Continue" }))
    expect(open().getByText("Describe your relationship to the student.")).toBeInTheDocument()
    await user.type(open().getByLabelText("Describe your relationship to the student"), "Aunt")
    await user.click(open().getByRole("button", { name: "Continue" }))
    await waitForQuestion("What is your phone number?")
    expect(screen.getByText("Other: Aunt")).toBeInTheDocument()
  })

  it("offers every class by level, and this year and next", async () => {
    const user = userEvent.setup()
    render(form("sw"))
    await user.type(open().getByRole("textbox"), "Neema Mfano")
    await user.click(open().getByRole("button", { name: "Endelea" }))
    await user.click(open().getByRole("button", { name: "Chagua darasa lingine" }))
    const sheet = await screen.findByRole("dialog", { name: "Chagua darasa" })
    const classes: string[] = []
    for (const level of ["Awali", "Msingi", "Sekondari"]) {
      await user.click(within(sheet).getByRole("tab", { name: level }))
      classes.push(...within(within(sheet).getByRole("tabpanel")).getAllByRole("button").map((b) => b.textContent ?? ""))
    }
    expect(classes).toEqual(["DAY CARE", "KG 1", "KG 2", "STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7", "FORM 1", "FORM 2", "FORM 3", "FORM 4"])
    await user.click(within(sheet).getByRole("button", { name: "Funga" }))

    await user.click(open().getByRole("button", { name: "Badilisha Mwaka" }))
    expect(open().getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual([`${years[0]} · Mwaka huu`, `${years[1]} · Mwaka ujao`])
    await user.click(open().getByRole("radio", { name: new RegExp(String(years[0])) }))
    expect(open().getByText(String(years[0]))).toBeInTheDocument()
    await user.click(open().getByRole("button", { name: /FORM 1/ }))
    await waitFor(() => expect(screen.getByText(`FORM 1 · ${years[0]}`)).toBeInTheDocument())
  })

  it("adds a second student with its label, copies Day or Boarding, asks about the students, and removes one", async () => {
    const user = userEvent.setup()
    render(form("sw"))
    await answerStudent(user, "Neema Mfano", "sw")
    await user.click(await screen.findByRole("button", { name: "Ndiyo, ongeza mwanafunzi" }))

    await waitForQuestion("Mwanafunzi wa pili anaitwa nani?")
    expect(screen.getByText("Mwanafunzi wa pili")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 3, name: "Wanafunzi" })).toBeInTheDocument()
    await answerStudent(user, "Juma Mfano", "sw", { day: false })
    // Juma's Day or Boarding started as Neema's.
    await waitFor(() => expect(open().getByRole("heading", { name: "Unaomba kwa mwanafunzi mwingine pia?" })).toBeInTheDocument())
    await user.click(open().getByRole("button", { name: "Hapana, endelea" }))
    await waitForQuestion("Jina lako kamili ni nani?")
    await user.type(open().getByRole("textbox"), "Asha Mfano")
    await user.click(open().getByRole("button", { name: "Endelea" }))
    await waitForQuestion("Wewe ni nani kwa wanafunzi hawa?")

    await user.click(screen.getByRole("button", { name: "Badilisha Taarifa, Juma Mfano" }))
    expect(screen.getByText("Kutwa", { selector: ".gf-sum-w span" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Ondoa Juma Mfano" }))
    await waitFor(() => expect(screen.queryByText(/Juma Mfano/)).not.toBeInTheDocument())
    expect(screen.getByRole("heading", { level: 3, name: "Mwanafunzi" })).toBeInTheDocument()
    expect(open().getByRole("heading", { name: "Wewe ni nani kwa Neema?" })).toBeInTheDocument()
  })

  it("refuses the same student twice, naming them", async () => {
    const user = userEvent.setup()
    render(form("en"))
    await answerStudent(user, "Zawadi Mfano", "en")
    await user.click(await screen.findByRole("button", { name: "Yes, add a student" }))
    await user.type(open().getByRole("textbox"), "  zawadi MFANO ")
    await user.click(open().getByRole("button", { name: "Continue" }))
    expect(open().getByText("Zawadi Mfano is on this form twice. Remove one, or correct the name.")).toBeInTheDocument()
  })

  it("stops adding students at eight", async () => {
    const user = userEvent.setup()
    render(form("en"))
    for (let n = 1; n <= 8; n++) {
      await answerStudent(user, `Mwanafunzi ${n} Mfano`, "en")
      if (n < 8) await user.click(await screen.findByRole("button", { name: "Yes, add a student" }))
    }
    await waitForQuestion("What is your full name?")
    expect(screen.getByText("You can apply for up to 8 students on one form.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Yes, add a student" })).not.toBeInTheDocument()
  })

  it("sends once, shows each Admission Number with a copy button, and Fill in another form starts empty", async () => {
    let finish: (value: unknown) => void = () => {}
    stubs.submit.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    render(form("sw"))
    await fillToSend(user, "sw")

    await send(user, "Tuma maombi")
    expect(open().getByRole("button", { name: "Inatuma…" })).toHaveAttribute("aria-busy", "true")
    const [, sent] = stubs.submit.mock.calls[0] as [unknown, FormData]
    expect(sent.get("cf-turnstile-response")).toBe("fake-token")
    const body = sentBody()
    expect(body.submissionKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.parent).toEqual({ fullName: "Amina Mfano", relationship: "Mother", phone: "0700 000 900" })
    expect(body.children).toEqual([{ fullName: "Zawadi Mfano", className: "STD 2", enrollmentYear: DEFAULT_YEAR, dayOrBoarding: "Day" }])
    expect(body.discountCode).toBeUndefined()

    finish({ status: "confirmed", children: [{ fullName: "Zawadi Mfano", admissionNumber: "ADMSN-40719" }] })
    expect(await screen.findByRole("heading", { name: "Maombi yamepokelewa!" })).toBeInTheDocument()
    expect(screen.getByText("Namba ya Udahili")).toBeInTheDocument()
    expect(screen.getByText("ADMSN-40719")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Nakili ADMSN-40719" })).toBeInTheDocument()
    expect(screen.getByText(/Hifadhi namba hii/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /\+255 700 000 001/ })).toHaveAttribute("href", "tel:+255700000001")
    // The progress bar goes, and no offer shows without a discount.
    expect(document.querySelector('button[aria-label="Rudi"]')).toBeNull()
    expect(screen.queryByText(/Ofa hii ni ya muda maalumu/)).not.toBeInTheDocument()
    expect(window.sessionStorage.length).toBe(0)

    await user.click(screen.getByRole("button", { name: "Jaza fomu nyingine" }))
    expect(open().getByRole("textbox")).toHaveValue("")

    // A new form gets a new key.
    stubs.submit.mockResolvedValue({ status: "unavailable" })
    await fillToSend(user, "sw")
    await send(user, "Tuma maombi")
    await waitFor(() => expect(stubs.submit).toHaveBeenCalledTimes(2))
    expect(sentBody(1).submissionKey).not.toBe(body.submissionKey)
  })

  it.each([
    ["rate-limited", /Umejaribu mara nyingi mno/],
    ["check-failed", /Ukaguzi wa usalama haukukamilika/],
    ["unavailable", /Hatukuweza kupokea maombi yako/],
  ])("on %s, says so, keeps the entries, resets the widget and keeps the key", async (status, text) => {
    stubs.submit.mockResolvedValue({ status })
    const user = userEvent.setup()
    render(form("sw"))
    await fillToSend(user, "sw")

    await send(user, "Tuma maombi")
    expect(await screen.findByRole("alert")).toHaveTextContent(text)
    expect(stubs.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Amina Mfano")).toBeInTheDocument()

    await send(user, "Tuma maombi")
    await waitFor(() => expect(stubs.submit).toHaveBeenCalledTimes(2))
    expect(sentBody(1).submissionKey).toBe(sentBody(0).submissionKey)
  })

  it("waits for the security check before sending", async () => {
    stubs.token = ""
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)

    await send(user, "Send application")
    expect(screen.getByRole("alert")).toHaveTextContent("Wait a moment for the security check to finish")
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("shows the code-holder notice at sending when a restored draft carries a code past an unopened code question", async () => {
    window.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        parent: { fullName: "Asha Mfano", relationship: "Mother", relationshipDescription: "", phone: "0700 000 900", whatsapp: "" },
        children: [{ fullName: "Zawadi Mfano", className: "STD 2", enrollmentYear: years[1], dayOrBoarding: "Day" }],
        discountCode: "BJN-402",
        linkCode: "",
        done: ["name-1", "class-1", "board-1", "more", "pname", "rel", "phone", "code", "fee"],
      }),
    )
    stubs.check.mockResolvedValue({ status: "approved", amount: 40000 })
    stubs.submit.mockResolvedValue({ status: "confirmed", children: [{ fullName: "Zawadi Mfano", admissionNumber: "ADMSN-40719" }] })
    const user = userEvent.setup()
    render(form("en"))

    await waitFor(() => expect(open().getByRole("button", { name: "Send application" })).toBeInTheDocument())
    expect(open().getByText(FORM_NOTICE.en)).toBeInTheDocument()
    await send(user, "Send application")
    await waitFor(() => expect(stubs.submit).toHaveBeenCalled())
    expect(sentBody()).toMatchObject({ discountCode: "BJN-402", noticeVersion: FORM_NOTICE_VERSION })
  })

  it("leaves the words to a security check that needs a click", async () => {
    stubs.token = ""
    stubs.reveal.mockReturnValue(true)
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)

    await send(user, "Send application")
    expect(stubs.reveal).toHaveBeenCalled()
    expect(screen.queryByText(/Wait a moment for the security check/)).toBeNull()
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("says on the fee question that nothing is paid on the form", async () => {
    const user = userEvent.setup()
    render(form("sw"))
    await answerStudent(user, "Zawadi Mfano", "sw")
    await waitFor(() => expect(open().getByRole("button", { name: W.sw.no })).toBeInTheDocument())
    await user.click(open().getByRole("button", { name: W.sw.no }))
    await answerCustodian(user, "sw")
    await user.click(open().getByRole("button", { name: W.sw.skip }))

    expect(await screen.findByText(/^Hulipi chochote kwenye fomu hii\./)).toBeInTheDocument()
  })

  it("sends the parent back to the phone when the database can't read it", async () => {
    stubs.submit.mockResolvedValue({ status: "invalid", field: "phone", child: null })
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)

    await send(user, "Send application")
    await waitForQuestion("What is your phone number?")
    expect(open().getByText(/We couldn't read that phone number/)).toBeInTheDocument()
    expect(open().getByRole("textbox")).toHaveValue("0700 000 900")
    expect(stubs.reset).toHaveBeenCalled()
  })

  it("sends the parent back to the student's class when the year has closed", async () => {
    const next: [number, number] = [years[1], years[1] + 1]
    stubs.submit.mockResolvedValue({ status: "invalid", field: "enrollment_year", child: 0, calendar: { years: next, defaultYear: next[0] } })
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)

    await send(user, "Send application")
    await waitForQuestion("Which class is Zawadi applying for?")
    expect(open().getByText("That year no longer takes applications. Choose another year.")).toBeInTheDocument()
    expect(open().getAllByRole("radio")).toHaveLength(2)
    expect(open().getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual(next.map((year) => expect.stringContaining(String(year))))
    // The cached page isn't rendered again: the refusal's years show in place.
    expect(stubs.refresh).not.toHaveBeenCalled()
  })

  it("makes a new key when the server says the key was used for a different form", async () => {
    stubs.submit.mockResolvedValue({ status: "invalid", field: "submission_key", child: null })
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)

    await send(user, "Send application")
    expect(await screen.findByRole("alert")).toHaveTextContent("Tap Send application again")
    await send(user, "Send application")
    await waitFor(() => expect(stubs.submit).toHaveBeenCalledTimes(2))
    expect(sentBody(1).submissionKey).not.toBe(sentBody(0).submissionKey)
  })

  it("keeps the same key when the parent edits after a send with no answer", async () => {
    stubs.submit.mockRejectedValueOnce(new Error("network dropped")).mockResolvedValue({ status: "unavailable" })
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)

    await send(user, "Send application")
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Change Details, Zawadi Mfano" }))
    await user.click(screen.getAllByRole("button", { name: "Change Name" })[0])
    await user.type(open().getByRole("textbox"), " Edited")
    await user.click(open().getByRole("button", { name: "Continue" }))
    await waitFor(() => expect(open().getByRole("button", { name: "Send application" })).toBeInTheDocument())
    await send(user, "Send application")

    await waitFor(() => expect(stubs.submit).toHaveBeenCalledTimes(2))
    expect(sentBody(1).children[0].fullName).toBe("Zawadi Mfano Edited")
    expect(sentBody(1).submissionKey).toBe(sentBody(0).submissionKey)
  })

  it("shows the earlier send's Admission Number, and says the edits weren't saved", async () => {
    stubs.submit.mockResolvedValue({ status: "already-sent", children: [{ fullName: "Zawadi Mfano", admissionNumber: "26-0042" }], complete: true })
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)

    await send(user, "Send application")
    expect(await screen.findByRole("heading", { name: "Application received!" })).toBeInTheDocument()
    expect(screen.getByText("26-0042")).toBeInTheDocument()
    expect(screen.getByText(/^This form had already been sent, so the changes/)).toBeInTheDocument()
  })

  it("ignores the answer to a send made before the form was cleared", async () => {
    let answer: (value: unknown) => void = () => {}
    stubs.submit.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)
    await send(user, "Send application")
    await waitFor(() => expect(stubs.submit).toHaveBeenCalled())

    await user.click(screen.getByRole("button", { name: "Menu" }))
    await user.click(screen.getByRole("button", { name: "Clear the whole form" }))
    await user.click(screen.getByRole("button", { name: "Yes, clear" }))
    answer({ status: "confirmed", children: [{ fullName: "Zawadi Mfano", admissionNumber: "ADMSN-40719" }] })

    await waitFor(() => expect(open().getByRole("textbox")).toBeInTheDocument())
    expect(screen.queryByRole("heading", { name: "Application received!" })).toBeNull()
  })

  it("says plainly when the earlier send reached only some students", async () => {
    stubs.submit.mockResolvedValue({ status: "already-sent", children: [{ fullName: "Zawadi Mfano", admissionNumber: "26-0042" }], complete: false })
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)

    await send(user, "Send application")
    expect(await screen.findByText("26-0042")).toBeInTheDocument()
    expect(screen.getByText(/not every student on it was received/)).toBeInTheDocument()
  })

  it.each(["sw", "en"] as const)("never says agent, referral, wakala, idhini or mtoto in %s", async (language) => {
    const user = userEvent.setup()
    remembered("BJN-402")
    render(form(language))
    stubs.check.mockResolvedValue({ status: "approved", amount: 40000 })
    await fillToSend(user, language).catch(() => undefined)
    // The code holder's notice is versioned wording from lib/referral-notice.ts.
    document.querySelectorAll("[data-notice-version]").forEach((notice) => notice.remove())
    const text = document.body.textContent ?? ""
    expect(text).not.toMatch(/agent|referral|wakala|idhini|approval|\bmtoto\b|\bwatoto\b/i)
  })
})

// The page is built ahead of time, so a copy built in December can still be
// served in January. The form works the years out again as it opens.
describe("the admission years of a cached copy", { timeout: 30_000 }, () => {
  afterEach(() => vi.useRealTimers())

  it.each([
    // 23:59 on 31 December in Tanzania (UTC+3): this year and next, from April.
    ["2026-12-31T20:59:00Z", 2027],
    // Midnight on 1 January: the new year and the one after; before April.
    ["2026-12-31T21:00:00Z", 2027],
    // 23:59 on 31 March: still before April.
    ["2027-03-31T20:59:00Z", 2027],
    // Midnight on 1 April: next year's intake.
    ["2027-03-31T21:00:00Z", 2028],
  ])("at %s a copy built on 30 December sends year %i by default", async (now, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(now))
    stubs.submit.mockResolvedValue({ status: "unavailable" })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={[2026, 2027]} defaultYear={2027} officePhone="+255 700 000 001" />)
    await fillToSend(user)

    await send(user, "Send application")
    await waitFor(() => expect(stubs.submit).toHaveBeenCalled())
    expect(sentBody().children[0].enrollmentYear).toBe(expected)
  })
})

describe("the Discount code question", { timeout: 30_000 }, () => {
  async function toCode(user: User, lang: "sw" | "en" = "en") {
    await answerStudent(user, "Zawadi Mfano", lang)
    await user.click(await screen.findByRole("button", { name: W[lang].no }))
    await answerCustodian(user, lang)
    await waitForQuestion(lang === "en" ? "Have a discount code?" : "Una code ya punguzo?")
  }

  it("moves on from the Discount code question when the check stalls", async () => {
    stubs.check.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    render(form("en"))
    await toCode(user)
    await user.type(open().getByLabelText(/Discount code/), "BJN-402")
    await user.click(open().getByRole("button", { name: "Continue" }))

    await waitFor(() => expect(open().getByRole("heading", { name: "Interview fee" })).toBeInTheDocument(), { timeout: 9000 })
  })

  it("checks a restored code when the fee question opens after a reload", async () => {
    window.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        parent: { fullName: "Asha Mfano", relationship: "Mother", relationshipDescription: "", phone: "0700 000 900", whatsapp: "" },
        children: [{ fullName: "Zawadi Mfano", className: "STD 2", enrollmentYear: years[1], dayOrBoarding: "Day" }],
        discountCode: "BJN-402",
        linkCode: "",
        done: ["name-1", "class-1", "board-1", "more", "pname", "rel", "phone", "code"],
      }),
    )
    stubs.check.mockResolvedValue({ status: "approved", amount: 40000 })
    render(form("en"))

    await waitFor(() => expect(open().getByRole("heading", { name: "Interview fee" })).toBeInTheDocument())
    await waitFor(() => expect(stubs.check).toHaveBeenCalledWith("BJN-402"))
    expect(await open().findAllByText("TZS 40,000")).not.toHaveLength(0)
  })

  it("promises no discount when an earlier send is what went through", async () => {
    stubs.check.mockResolvedValue({ status: "approved", amount: 40000 })
    stubs.submit.mockResolvedValue({ status: "already-sent", children: [{ fullName: "Zawadi Mfano", admissionNumber: "26-0042" }], complete: true })
    const user = userEvent.setup()
    render(form("en"))
    await toCode(user, "en")
    await user.type(open().getByLabelText(/Discount code/), "BJN-402")
    await user.click(open().getByRole("button", { name: "Continue" }))
    await waitForQuestion("Interview fee")
    await user.click(open().getByRole("button", { name: "Continue" }))

    await send(user, "Send application")
    expect(await screen.findByRole("heading", { name: "Application received!" })).toBeInTheDocument()
    expect(screen.queryByText(/discount is waiting/i)).toBeNull()
  })


  it("is optional and empty without a link, with the full fee and no saving until the live figure arrives", async () => {
    const user = userEvent.setup()
    render(form("en"))
    await toCode(user)
    expect(open().getByLabelText(/Discount code/)).toHaveValue("")
    expect(open().getByText("TZS 50,000")).toBeInTheDocument()
    expect(open().queryByText(/^Save TZS/)).not.toBeInTheDocument()
    await user.click(open().getByRole("button", { name: "Skip, no code" }))
    await waitForQuestion("Interview fee")
    expect(open().getAllByText("TZS 50,000")).toHaveLength(2)
  })

  it("shows the live discount against the full fee", async () => {
    live = { applications: 1284, discount: 10000 }
    const user = userEvent.setup()
    render(form("en"))
    await toCode(user)
    expect(open().getByText("Save TZS 10,000")).toBeInTheDocument()
    expect(open().getByText("50,000", { selector: "s" })).toBeInTheDocument()
    expect(open().getByText(/→ 40,000/)).toBeInTheDocument()
  })

  it("starts from the link's code, remembers it for 30 days, and checks it as the question opens", async () => {
    stubs.check.mockResolvedValue({ status: "approved", amount: 40000 })
    const user = userEvent.setup()
    openedFromLink("BJN-402")
    render(form("sw"))
    expect(document.cookie).toContain("discount_code=BJN-402")
    await toCode(user, "sw")

    expect(open().getByLabelText(/Code ya Punguzo/)).toHaveValue("BJN-402")
    await waitFor(() => expect(stubs.check).toHaveBeenCalledWith("BJN-402"))
    expect(await screen.findByText("Hongera! Umeokoa TZS 10,000 kwa kila mwanafunzi.")).toBeInTheDocument()
    expect(open().getByText("Ofa hii ni ya muda mfupi")).toBeInTheDocument()
    expect(open().getByText(FORM_NOTICE.sw)).toHaveAttribute("data-notice-version", FORM_NOTICE_VERSION)
  })

  it("checks a typed code with Hakiki Punguzo, and only when it changed", async () => {
    stubs.check.mockResolvedValue({ status: "pending", amount: 50000 })
    const user = userEvent.setup()
    render(form("sw"))
    await toCode(user, "sw")
    await user.type(open().getByLabelText(/Code ya Punguzo/), "bjn-402")
    await user.click(open().getByRole("button", { name: "Hakiki Punguzo" }))
    expect(await screen.findByText(/inasubiri kuthibitishwa/)).toBeInTheDocument()
    await user.click(open().getByRole("button", { name: "Hakiki Punguzo" }))
    expect(stubs.check).toHaveBeenCalledTimes(1)
  })

  it("stops once on a code nobody has, then lets the parent go on", async () => {
    stubs.check.mockResolvedValue({ status: "unknown", amount: 50000 })
    const user = userEvent.setup()
    render(form("en"))
    await toCode(user)
    await user.type(open().getByLabelText(/Discount code/), "NOBODY-1")
    await user.click(open().getByRole("button", { name: "Continue" }))
    expect(await screen.findByText(/We don't recognise this code/)).toBeInTheDocument()
    await user.click(open().getByRole("button", { name: "Continue" }))
    await waitForQuestion("Interview fee")
    expect(screen.getByText(/· not recognised/)).toBeInTheDocument()
  })

  it("names a value that isn't a code under the field, and won't send it", async () => {
    const user = userEvent.setup()
    render(form("en"))
    await toCode(user)
    await user.type(open().getByLabelText(/Discount code/), "not a code!")
    await user.click(open().getByRole("button", { name: "Continue" }))
    expect(open().getByText(/A discount code has only letters, numbers/)).toBeInTheDocument()
    expect(stubs.check).not.toHaveBeenCalled()
  })

  it("brings the fee down for a confirmed code, opens the offer sheet, and sends the code with the notice version", async () => {
    live = { applications: 1284, discount: 10000 }
    stubs.check.mockResolvedValue({ status: "approved", amount: 40000 })
    stubs.submit.mockResolvedValue({ status: "confirmed", children: [{ fullName: "Zawadi Mfano", admissionNumber: "ADMSN-40719" }] })
    const user = userEvent.setup()
    render(form("sw"))
    await toCode(user, "sw")
    await user.type(open().getByLabelText(/Code ya Punguzo/), "BJN-402")
    await user.click(open().getByRole("button", { name: "Endelea" }))

    await waitForQuestion("Ada ya usaili")
    expect(open().getAllByText("TZS 40,000")).toHaveLength(2)
    expect(open().getByText("Umeokoa TZS 10,000")).toBeInTheDocument()
    await user.click(open().getByRole("button", { name: "Kuhusu ofa ya muda maalum" }))
    const sheet = await screen.findByRole("dialog", { name: "Ofa ya muda maalum" })
    expect(within(sheet).getByText("Nafasi ni chache: mpaka sasa tuna maombi 1,284.")).toBeInTheDocument()
    await user.click(within(sheet).getByRole("button", { name: "Sawa, nimeelewa" }))
    await user.click(open().getByRole("button", { name: "Endelea" }))
    expect(await screen.findByRole("button", { name: "Ofa ya muda maalum" })).toBeInTheDocument()

    await send(user, "Tuma maombi")
    expect(await screen.findByRole("heading", { name: "Maombi yamepokelewa!" })).toBeInTheDocument()
    expect(sentBody()).toMatchObject({ discountCode: "BJN-402", noticeVersion: FORM_NOTICE_VERSION })
    expect(screen.getByText("Punguzo lako la TZS 10,000 linakusubiri")).toBeInTheDocument()
    const offer = screen.getByRole("note")
    expect(offer).toHaveTextContent(
      "Ofa hii ni ya muda maalumu na inaweza kuondolewa wakati wowote. Pia nafasi ni chache sababu mpaka sasa tuna maombi",
    )
    expect(within(offer).getByText("1,284")).toHaveClass("gf-live")
    expect(offer).toHaveTextContent("Hivyo mlete mwanafunzi kwenye usaili mapema, Ikiwezekana mlete wiki hii ndani ya siku za kazi.")
  })

  it("states the code's own amount from its estimate, not the standard discount", async () => {
    // A Promo code or an agent with an own amount: TZS 25,000 off, whatever
    // the standard discount is.
    live = { applications: null, discount: 10000 }
    stubs.check.mockResolvedValue({ status: "approved", amount: 25000 })
    const user = userEvent.setup()
    remembered("INSTA26")
    render(form("en"))
    await toCode(user)
    expect(await screen.findByText("Well done! You save TZS 25,000 for each student.")).toBeInTheDocument()
    await user.click(open().getByRole("button", { name: "Continue" }))
    await waitForQuestion("Interview fee")
    expect(open().getByText("You save TZS 25,000")).toBeInTheDocument()
  })

  it("promises no saving for a confirmed code set to nothing off", async () => {
    stubs.check.mockResolvedValue({ status: "approved", amount: 50000 })
    const user = userEvent.setup()
    remembered("ZERO26")
    render(form("en"))
    await toCode(user)
    expect(await screen.findByText("This code gives no discount at the moment. You can still send the form.")).toBeInTheDocument()
    expect(screen.queryByText(/You save/)).not.toBeInTheDocument()
    expect(screen.queryByText("This offer is for a limited time")).not.toBeInTheDocument()
  })

  it("leaves the count sentence out of the offer when the count is below the minimum", async () => {
    live = { applications: 40, discount: 10000 }
    stubs.check.mockResolvedValue({ status: "approved", amount: 40000 })
    stubs.submit.mockResolvedValue({ status: "confirmed", children: [{ fullName: "Zawadi Mfano", admissionNumber: "ADMSN-40719" }] })
    const user = userEvent.setup()
    remembered("BJN-402")
    render(form("sw"))
    await toCode(user, "sw")
    await screen.findByText(/Hongera!/)
    await user.click(open().getByRole("button", { name: "Endelea" }))
    await waitForQuestion("Ada ya usaili")
    await user.click(open().getByRole("button", { name: "Kuhusu ofa ya muda maalum" }))
    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).queryByText(/mpaka sasa tuna maombi/)).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole("button", { name: "Sawa, nimeelewa" }))
    await user.click(open().getByRole("button", { name: "Endelea" }))
    await user.click(await screen.findByRole("button", { name: "Tuma maombi" }))

    const offer = await screen.findByRole("note")
    expect(offer).toHaveTextContent("Ofa hii ni ya muda maalumu na inaweza kuondolewa wakati wowote.")
    expect(offer).toHaveTextContent("Hivyo mlete mwanafunzi kwenye usaili mapema")
    expect(offer).not.toHaveTextContent(/nafasi ni chache|40/)
  })

  it("sends no code when the field is empty", async () => {
    stubs.submit.mockResolvedValue({ status: "unavailable" })
    const user = userEvent.setup()
    render(form("en"))
    await fillToSend(user)
    await send(user, "Send application")
    await waitFor(() => expect(stubs.submit).toHaveBeenCalled())
    expect(sentBody().discountCode).toBeUndefined()
    expect(sentBody().noticeVersion).toBeUndefined()
  })
})
