import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef, useImperativeHandle } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const jar = vi.hoisted(() => ({ values: new Map<string, string>() }))
const stubs = vi.hoisted(() => ({ submit: vi.fn(), reset: vi.fn(), refresh: vi.fn(), token: "fake-token" }))

vi.mock("@/lib/office", () => ({ OFFICE_PHONE: "+255 700 000 001" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
  }),
}))
// The form page must render with Supabase down: any use of a Supabase client
// fails this test.
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => {
    throw new Error("the Admission form must not read Supabase to render")
  },
}))
vi.mock("@/app/apply/actions", () => ({ submitAdmissionForm: stubs.submit }))
vi.mock("@/app/actions/language", () => ({ setLanguage: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stubs.refresh }) }))
vi.mock("@/components/turnstile-widget", () => ({
  TurnstileWidget: forwardRef(function FakeTurnstile(_: unknown, ref) {
    useImperativeHandle(ref, () => ({ reset: stubs.reset }))
    return <input type="hidden" name="cf-turnstile-response" value={stubs.token} readOnly />
  }),
}))

import { AdmissionFormSteps } from "@/app/apply/admission-form"
import ApplyPage from "@/app/apply/page"
import { admissionYears } from "@/lib/admission-form"

const years = admissionYears()

beforeEach(() => {
  jar.values.clear()
  stubs.submit.mockReset()
  stubs.reset.mockReset()
  stubs.refresh.mockReset()
  stubs.token = "fake-token"
})

async function fillParentAndChild(user: ReturnType<typeof userEvent.setup>, lang: "sw" | "en" = "en") {
  const t =
    lang === "en"
      ? { name: "Parent or guardian's full name", mother: "Mother", phone: "Phone number", next: "Continue", child: "Child's full name", day: "Day" }
      : { name: "Jina kamili la mzazi au mlezi", mother: "Mama", phone: "Namba ya simu", next: "Endelea", child: "Jina kamili la mtoto", day: "Kutwa" }
  await user.type(screen.getByLabelText(t.name), "Amina Fixture")
  await user.click(screen.getByRole("button", { name: t.mother }))
  await user.type(screen.getByLabelText(t.phone, { exact: false }), "0700 000 900")
  await user.click(screen.getByRole("button", { name: t.next }))
  await user.type(screen.getByLabelText(t.child), "Zawadi Fixture")
  await user.click(screen.getByRole("button", { name: "STD 2" }))
  await user.click(screen.getByRole("button", { name: String(years[1]) }))
  await user.click(screen.getByRole("button", { name: t.day }))
  await user.click(screen.getByRole("button", { name: t.next }))
}

describe("the Admission form page", () => {
  it("renders in Swahili by default, reading no Supabase", async () => {
    render(await ApplyPage())

    expect(screen.getByRole("main")).toHaveAttribute("lang", "sw")
    expect(screen.getByRole("heading", { level: 1, name: "Mzazi au mlezi" })).toBeInTheDocument()
    expect(screen.getByText("Hatua 1 kati ya 3")).toBeInTheDocument()
    for (const word of ["Mama", "Baba", "Mlezi", "Mwingine"]) {
      expect(screen.getByRole("button", { name: word })).toBeInTheDocument()
    }
  })

  it("renders in English when the language cookie says so", async () => {
    jar.values.set("lang", "en")
    render(await ApplyPage())

    expect(screen.getByRole("main")).toHaveAttribute("lang", "en")
    expect(screen.getByRole("heading", { level: 1, name: "Parent or guardian" })).toBeInTheDocument()
  })

  it("offers the 14 classes with no Pre-Form One, this year and next, and Kutwa or Bweni", async () => {
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="sw" years={years} officePhone="+255 700 000 001" />)
    await user.type(screen.getByLabelText("Jina kamili la mzazi au mlezi"), "Amina Fixture")
    await user.click(screen.getByRole("button", { name: "Mama" }))
    await user.type(screen.getByLabelText("Namba ya simu", { exact: false }), "0700000900")
    await user.click(screen.getByRole("button", { name: "Endelea" }))

    const classes = within(screen.getByRole("group", { name: "Darasa analoomba" })).getAllByRole("button")
    expect(classes.map((c) => c.textContent)).toEqual([
      "DAY CARE", "KG 1", "KG 2", "STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7",
      "FORM 1", "FORM 2", "FORM 3", "FORM 4",
    ])
    const yearChips = within(screen.getByRole("group", { name: "Mwaka wa kujiunga" })).getAllByRole("button")
    expect(yearChips.map((c) => c.textContent)).toEqual(years.map(String))
    expect(screen.getByRole("button", { name: "Kutwa" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bweni" })).toBeInTheDocument()
  })

  it("Continue names the missing field, and Other asks for a description", async () => {
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)

    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByText("Enter the parent or guardian's full name.")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: "Parent or guardian" })).toBeInTheDocument()

    await user.type(screen.getByLabelText("Parent or guardian's full name"), "Amina Fixture")
    await user.click(screen.getByRole("button", { name: "Other" }))
    await user.type(screen.getByLabelText("Phone number", { exact: false }), "0700000900")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByText("Describe your relationship to the child.", { selector: "p" })).toBeInTheDocument()

    await user.type(screen.getByLabelText("Describe your relationship to the child"), "Aunt")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByRole("heading", { level: 1, name: "Children" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByText("Enter the child's full name.")).toBeInTheDocument()
  })

  it("keeps every entry when the language switches mid-form, and Back keeps them too", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<AdmissionFormSteps language="sw" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user, "sw")
    expect(screen.getByRole("heading", { level: 1, name: "Hakiki maombi yako" })).toBeInTheDocument()

    rerender(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    expect(screen.getByRole("heading", { level: 1, name: "Check your application" })).toBeInTheDocument()
    expect(screen.getByText("Amina Fixture")).toBeInTheDocument()
    expect(screen.getByText(`STD 2 · ${years[1]} · Day`)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByLabelText("Child's full name")).toHaveValue("Zawadi Fixture")
    expect(screen.getByRole("button", { name: "STD 2" })).toHaveAttribute("aria-pressed", "true")
    await user.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByLabelText("Parent or guardian's full name")).toHaveValue("Amina Fixture")
    expect(screen.getByRole("button", { name: "Mother" })).toHaveAttribute("aria-pressed", "true")
  })

  it("sends once, shows the Admission Number, the office phone, and Fill in another form starts empty", async () => {
    let finish: (value: unknown) => void = () => {}
    stubs.submit.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="sw" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user, "sw")

    await user.click(screen.getByRole("button", { name: "Tuma maombi" }))
    expect(screen.getByRole("button", { name: "Inatuma…" })).toBeDisabled()
    const [, sent] = stubs.submit.mock.calls[0] as [unknown, FormData]
    expect(sent.get("cf-turnstile-response")).toBe("fake-token")
    const body = JSON.parse(String(sent.get("form")))
    expect(body.submissionKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.children).toEqual([{ fullName: "Zawadi Fixture", className: "STD 2", enrollmentYear: years[1], dayOrBoarding: "Day" }])

    finish({ status: "confirmed", children: [{ fullName: "Zawadi Fixture", admissionNumber: "ADMSN-40719" }] })
    expect(await screen.findByRole("heading", { name: "Maombi yamepokelewa!" })).toBeInTheDocument()
    expect(screen.getByText("Namba ya Udahili")).toBeInTheDocument()
    expect(screen.getByText("ADMSN-40719")).toBeInTheDocument()
    expect(screen.getByText(/Hifadhi namba hii/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /\+255 700 000 001/ })).toHaveAttribute("href", "tel:+255700000001")
    expect(stubs.submit).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: "Jaza fomu nyingine" }))
    expect(screen.getByLabelText("Jina kamili la mzazi au mlezi")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Mama" })).toHaveAttribute("aria-pressed", "false")

    // A new form gets a new key.
    stubs.submit.mockResolvedValue({ status: "unavailable" })
    await fillParentAndChild(user, "sw")
    await user.click(screen.getByRole("button", { name: "Tuma maombi" }))
    const [, again] = stubs.submit.mock.calls[1] as [unknown, FormData]
    expect(JSON.parse(String(again.get("form"))).submissionKey).not.toBe(body.submissionKey)
  })

  it.each([
    ["rate-limited", /Umejaribu mara nyingi mno/],
    ["check-failed", /Ukaguzi wa usalama haukukamilika/],
    ["unavailable", /Hatukuweza kupokea maombi yako/],
  ])("on %s, says so, keeps the entries, resets the widget and keeps the key", async (status, text) => {
    stubs.submit.mockResolvedValue({ status })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="sw" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user, "sw")

    await user.click(screen.getByRole("button", { name: "Tuma maombi" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(text)
    expect(stubs.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Amina Fixture")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Tuma maombi" }))
    const [first, second] = stubs.submit.mock.calls.map(([, data]) => JSON.parse(String((data as FormData).get("form"))))
    expect(second.submissionKey).toBe(first.submissionKey)
  })

  it("waits for the security check before sending", async () => {
    stubs.token = ""
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)

    await user.click(screen.getByRole("button", { name: "Send application" }))
    expect(screen.getByRole("alert")).toHaveTextContent("Wait a moment for the security check to finish")
    expect(stubs.submit).not.toHaveBeenCalled()
  })

  it("sends the parent back to the phone when the database can't read it", async () => {
    stubs.submit.mockResolvedValue({ status: "invalid", field: "phone", child: null })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)

    await user.click(screen.getByRole("button", { name: "Send application" }))
    expect(await screen.findByRole("heading", { level: 1, name: "Parent or guardian" })).toBeInTheDocument()
    expect(screen.getByText(/We couldn't read that phone number/)).toBeInTheDocument()
    expect(screen.getByLabelText("Phone number", { exact: false })).toHaveValue("0700 000 900")
    expect(stubs.reset).toHaveBeenCalled()
  })

  it("sends the parent back to the child card when the year has closed", async () => {
    stubs.submit.mockResolvedValue({ status: "invalid", field: "enrollment_year", child: 0 })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)

    await user.click(screen.getByRole("button", { name: "Send application" }))
    expect(await screen.findByRole("heading", { level: 1, name: "Children" })).toBeInTheDocument()
    expect(screen.getByText("That year no longer takes applications. Choose another year.")).toBeInTheDocument()
    // The page renders again, with the new year chips.
    expect(stubs.refresh).toHaveBeenCalledTimes(1)
  })

  it("makes a new key when the server says the key was used for a different form", async () => {
    stubs.submit.mockResolvedValue({ status: "invalid", field: "submission_key", child: null })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)

    await user.click(screen.getByRole("button", { name: "Send application" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Tap Send application again")
    await user.click(screen.getByRole("button", { name: "Send application" }))
    const [first, second] = stubs.submit.mock.calls.map(([, data]) => JSON.parse(String((data as FormData).get("form"))))
    expect(second.submissionKey).not.toBe(first.submissionKey)
  })

  it("shows no agent code, fee, 'already in our records' note or Saturday interviews line", async () => {
    for (const language of ["sw", "en"] as const) {
      const user = userEvent.setup()
      const { container, unmount } = render(<AdmissionFormSteps language={language} years={years} officePhone="+255 700 000 001" />)
      await fillParentAndChild(user, language)
      expect(container.textContent).not.toMatch(/wakala|agent|ada|fee|TZS|Jumamosi|Saturday|kumbukumbu|records/i)
      unmount()
    }
  })
})
