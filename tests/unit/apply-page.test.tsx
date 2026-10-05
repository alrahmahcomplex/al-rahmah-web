import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef, useImperativeHandle } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const jar = vi.hoisted(() => ({ values: new Map<string, string>() }))
const stubs = vi.hoisted(() => ({ submit: vi.fn(), check: vi.fn(), reset: vi.fn(), refresh: vi.fn(), token: "fake-token" }))

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
vi.mock("@/app/apply/actions", () => ({ submitAdmissionForm: stubs.submit, checkDiscountCode: stubs.check }))
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
  stubs.check.mockReset()
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

// Each test types a whole form, which takes seconds on a loaded machine.
describe("the Admission form page", { timeout: 20_000 }, () => {
  it("renders in Swahili by default, reading no Supabase", async () => {
    render(await ApplyPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole("main")).toHaveAttribute("lang", "sw")
    expect(screen.getByRole("heading", { level: 1, name: "Mzazi au mlezi" })).toBeInTheDocument()
    expect(screen.getByText("Hatua 1 kati ya 3")).toBeInTheDocument()
    for (const word of ["Mama", "Baba", "Mlezi", "Mwingine"]) {
      expect(screen.getByRole("button", { name: word })).toBeInTheDocument()
    }
  })

  it("renders in English when the language cookie says so", async () => {
    jar.values.set("lang", "en")
    render(await ApplyPage({ searchParams: Promise.resolve({}) }))

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

  it("keeps the same key when the parent edits after a send with no answer", async () => {
    stubs.submit.mockRejectedValueOnce(new Error("network dropped")).mockResolvedValue({ status: "unavailable" })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)

    await user.click(screen.getByRole("button", { name: "Send application" }))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.type(screen.getByLabelText("Child's full name"), " Edited")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await user.click(screen.getByRole("button", { name: "Send application" }))

    const [first, second] = stubs.submit.mock.calls.map(([, data]) => JSON.parse(String((data as FormData).get("form"))))
    expect(second.children[0].fullName).toBe("Zawadi Fixture Edited")
    expect(second.submissionKey).toBe(first.submissionKey)
  })

  it("shows the earlier send's Admission Number, and says the edits weren't saved", async () => {
    stubs.submit.mockResolvedValue({
      status: "already-sent",
      children: [{ fullName: "Zawadi Fixture", admissionNumber: "26-0042" }],
      complete: true,
    })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)

    await user.click(screen.getByRole("button", { name: "Send application" }))
    expect(await screen.findByRole("heading", { level: 1, name: "Application received!" })).toBeInTheDocument()
    expect(screen.getByText("26-0042")).toBeInTheDocument()
    expect(screen.getByText(/^This form had already been sent, so the changes/)).toBeInTheDocument()
  })

  it("says plainly when the earlier send reached only some children", async () => {
    stubs.submit.mockResolvedValue({
      status: "already-sent",
      children: [{ fullName: "Zawadi Fixture", admissionNumber: "26-0042" }],
      complete: false,
    })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)

    await user.click(screen.getByRole("button", { name: "Send application" }))
    expect(await screen.findByText("26-0042")).toBeInTheDocument()
    expect(screen.getByText(/not every child on it was received/)).toBeInTheDocument()
  })

  it("adds child cards up to eight, and removes any card while more than one remains", async () => {
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)
    await user.click(screen.getByRole("button", { name: "Back" }))

    // One card: nothing to remove.
    expect(screen.queryByRole("button", { name: /^Remove child/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Add another child" }))
    const second = screen.getByRole("group", { name: "Child 2" })
    expect(within(second).getByLabelText("Child's full name")).toHaveFocus()
    expect(within(second).getByLabelText("Child's full name")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Remove child 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Remove child 2" })).toBeInTheDocument()

    // Removing the first card keeps the second one's entries, now as Child 1.
    await user.type(within(second).getByLabelText("Child's full name"), "Baraka Fixture")
    await user.click(screen.getByRole("button", { name: "Remove child 1" }))
    expect(screen.queryByRole("group", { name: "Child 2" })).not.toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Child 1" })).toHaveFocus()
    expect(within(screen.getByRole("group", { name: "Child 1" })).getByLabelText("Child's full name")).toHaveValue("Baraka Fixture")
    expect(screen.queryByRole("button", { name: /^Remove child/ })).not.toBeInTheDocument()

    for (let count = 2; count <= 8; count++) {
      await user.click(screen.getByRole("button", { name: "Add another child" }))
      expect(screen.getByRole("group", { name: `Child ${count}` })).toBeInTheDocument()
    }
    expect(screen.queryByRole("button", { name: "Add another child" })).not.toBeInTheDocument()
    expect(screen.getByText("You can apply for up to 8 children on one form.")).toBeInTheDocument()
  })

  it("checks every child card before Continue, on the card that needs it", async () => {
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(screen.getByRole("button", { name: "Add another child" }))
    await user.click(screen.getByRole("button", { name: "Continue" }))

    const second = screen.getByRole("group", { name: "Child 2" })
    expect(within(second).getByText("Enter the child's full name.")).toBeInTheDocument()
    expect(within(second).getByLabelText("Child's full name")).toHaveFocus()
    expect(within(screen.getByRole("group", { name: "Child 1" })).queryByText("Enter the child's full name.")).toBeNull()
  })

  it("refuses the same child twice before Continue, naming the child", async () => {
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(screen.getByRole("button", { name: "Add another child" }))
    const second = screen.getByRole("group", { name: "Child 2" })
    await user.type(within(second).getByLabelText("Child's full name"), "  zawadi   FIXTURE ")
    await user.click(within(second).getByRole("button", { name: "STD 2" }))
    await user.click(within(second).getByRole("button", { name: String(years[1]) }))
    await user.click(within(second).getByRole("button", { name: "Boarding" }))
    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(screen.getByRole("heading", { level: 1, name: "Children" })).toBeInTheDocument()
    expect(within(second).getByText("Zawadi Fixture is on this form twice. Remove one of the two cards, or correct the name.")).toBeInTheDocument()
    expect(within(second).getByLabelText("Child's full name")).toHaveFocus()

    // The same name typed exactly alike is caught too.
    await user.clear(within(second).getByLabelText("Child's full name"))
    await user.type(within(second).getByLabelText("Child's full name"), "Zawadi Fixture")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(within(second).getByText(/^Zawadi Fixture is on this form twice/)).toBeInTheDocument()
  })

  it("sends every child in form order, lists them all on review and confirmation", async () => {
    stubs.submit.mockResolvedValue({
      status: "confirmed",
      children: [
        { fullName: "Zawadi Fixture", admissionNumber: "ADMSN-40719" },
        { fullName: "Baraka Fixture", admissionNumber: "ADMSN-40720" },
      ],
    })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user)
    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(screen.getByRole("button", { name: "Add another child" }))
    const second = screen.getByRole("group", { name: "Child 2" })
    await user.type(within(second).getByLabelText("Child's full name"), "Baraka Fixture")
    await user.click(within(second).getByRole("button", { name: "FORM 1" }))
    await user.click(within(second).getByRole("button", { name: String(years[0]) }))
    await user.click(within(second).getByRole("button", { name: "Boarding" }))
    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(screen.getByRole("heading", { level: 1, name: "Check your application" })).toBeInTheDocument()
    expect(screen.getByText("Child 1")).toBeInTheDocument()
    expect(screen.getByText(`STD 2 · ${years[1]} · Day`)).toBeInTheDocument()
    expect(screen.getByText("Child 2")).toBeInTheDocument()
    expect(screen.getByText("Baraka Fixture")).toBeInTheDocument()
    expect(screen.getByText(`FORM 1 · ${years[0]} · Boarding`)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Send application" }))
    const [, sent] = stubs.submit.mock.calls[0] as [unknown, FormData]
    expect(JSON.parse(String(sent.get("form"))).children).toEqual([
      { fullName: "Zawadi Fixture", className: "STD 2", enrollmentYear: years[1], dayOrBoarding: "Day" },
      { fullName: "Baraka Fixture", className: "FORM 1", enrollmentYear: years[0], dayOrBoarding: "Boarding" },
    ])

    expect(await screen.findByRole("heading", { name: "Application received!" })).toBeInTheDocument()
    const listed = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(listed.map((item) => item.textContent)).toEqual([
      "Zawadi FixtureAdmission NumberADMSN-40719",
      "Baraka FixtureAdmission NumberADMSN-40720",
    ])
    expect(screen.getByText(/^Keep these numbers and bring them/)).toBeInTheDocument()

    // Fill in another form starts with one empty card.
    await user.click(screen.getByRole("button", { name: "Fill in another form" }))
    await user.type(screen.getByLabelText("Parent or guardian's full name"), "Amina Fixture")
    await user.click(screen.getByRole("button", { name: "Mother" }))
    await user.type(screen.getByLabelText("Phone number", { exact: false }), "0700 000 900")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getAllByRole("group", { name: /^Child \d$/ })).toHaveLength(1)
    expect(screen.getByLabelText("Child's full name")).toHaveValue("")
  })

  it("sends the parent back to the card the server refused as the same child twice", async () => {
    stubs.submit.mockResolvedValue({ status: "invalid", field: "duplicate_child", child: 1 })
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="sw" years={years} officePhone="+255 700 000 001" />)
    await fillParentAndChild(user, "sw")
    await user.click(screen.getByRole("button", { name: "Rudi" }))
    await user.click(screen.getByRole("button", { name: "Ongeza mtoto mwingine" }))
    const second = screen.getByRole("group", { name: "Mtoto 2" })
    await user.type(within(second).getByLabelText("Jina kamili la mtoto"), "Zawadi Fixtures")
    await user.click(within(second).getByRole("button", { name: "STD 2" }))
    await user.click(within(second).getByRole("button", { name: String(years[1]) }))
    await user.click(within(second).getByRole("button", { name: "Kutwa" }))
    await user.click(screen.getByRole("button", { name: "Endelea" }))
    await user.click(screen.getByRole("button", { name: "Tuma maombi" }))

    expect(await screen.findByRole("heading", { level: 1, name: "Watoto" })).toBeInTheDocument()
    expect(
      within(screen.getByRole("group", { name: "Mtoto 2" })).getByText(
        "Zawadi Fixtures yupo mara mbili kwenye fomu hii. Ondoa mojawapo ya kadi hizo mbili, au sahihisha jina.",
      ),
    ).toBeInTheDocument()
  })

  it("never mentions agents, referrals or approval, an 'already in our records' note or Saturday interviews", async () => {
    stubs.check.mockResolvedValue({ status: "pending", amount: 50000 })
    for (const language of ["sw", "en"] as const) {
      const user = userEvent.setup()
      const { container, unmount } = render(
        <AdmissionFormSteps language={language} years={years} officePhone="+255 700 000 001" discountCode="ZNM-401" />,
      )
      await fillParentAndChild(user, language)
      await screen.findByText(language === "en" ? /waiting to be confirmed/ : /inasubiri kuthibitishwa/)
      expect(container.textContent).not.toMatch(/wakala|agent|referral|approv|idhini|Jumamosi|Saturday|kumbukumbu|records/i)
      unmount()
    }
  })
})

describe("the Discount code on the review step", { timeout: 20_000 }, () => {
  beforeEach(() => {
    for (const cookie of document.cookie.split("; ")) {
      const name = cookie.split("=")[0]
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
    }
  })

  it.each([
    ["the link's code over the remembered one", { ref: "bjn-402" }, "ZNM-401", "BJN-402"],
    ["the remembered code on a visit without a link", {}, "ZNM-401", "ZNM-401"],
    ["nothing with neither", {}, undefined, ""],
  ])("the page starts the field from %s, reading no Supabase", async (_, params, remembered, expected) => {
    jar.values.set("lang", "en")
    if (remembered) jar.values.set("discount_code", remembered)
    stubs.check.mockResolvedValue({ status: "unavailable" })
    const user = userEvent.setup()
    render(await ApplyPage({ searchParams: Promise.resolve(params) }))
    await fillParentAndChild(user)
    expect(screen.getByLabelText("Discount code · optional")).toHaveValue(expected)
  })

  async function reviewStep(props: { discountCode?: string; rememberDiscountCode?: string | null } = {}, children = 1) {
    const user = userEvent.setup()
    render(<AdmissionFormSteps language="en" years={years} officePhone="+255 700 000 001" {...props} />)
    await fillParentAndChild(user)
    for (let n = 2; n <= children; n++) {
      await user.click(screen.getByRole("button", { name: "Back" }))
      await user.click(screen.getByRole("button", { name: "Add another child" }))
      const card = screen.getByRole("group", { name: `Child ${n}` })
      await user.type(within(card).getByLabelText("Child's full name"), `Sibling Fixture ${n}`)
      await user.click(within(card).getByRole("button", { name: "STD 2" }))
      await user.click(within(card).getByRole("button", { name: String(years[1]) }))
      await user.click(within(card).getByRole("button", { name: "Day" }))
      await user.click(screen.getByRole("button", { name: "Continue" }))
    }
    return user
  }

  it("is optional, empty without a link, and shows the standard fee for one child", async () => {
    await reviewStep()
    expect(screen.getByLabelText("Discount code · optional")).toHaveValue("")
    expect(screen.getByText("If someone gave you a discount code, enter it here.")).toBeInTheDocument()
    expect(screen.getByText("TZS 50,000 per child")).toBeInTheDocument()
    expect(screen.getByText("Total: TZS 50,000")).toBeInTheDocument()
    expect(stubs.check).not.toHaveBeenCalled()
  })

  it("starts from the link's code, remembers it for 30 days, and checks it as the step opens", async () => {
    stubs.check.mockResolvedValue({ status: "approved", amount: 30000 })
    await reviewStep({ discountCode: "BJN-402", rememberDiscountCode: "BJN-402" })

    expect(document.cookie).toContain("discount_code=BJN-402")
    expect(screen.getByLabelText("Discount code · optional")).toHaveValue("BJN-402")
    expect(await screen.findByText("TZS 20,000 off the interview fee for each child.")).toBeInTheDocument()
    expect(stubs.check).toHaveBeenCalledWith("BJN-402")
    expect(screen.getByText("TZS 30,000 per child")).toBeInTheDocument()
    expect(screen.getByText("Total: TZS 30,000")).toBeInTheDocument()
  })

  it("leaves the remembered code alone on a visit without a link", async () => {
    document.cookie = "discount_code=ZNM-401; Path=/"
    stubs.check.mockResolvedValue({ status: "pending", amount: 50000 })
    await reviewStep({ discountCode: "ZNM-401", rememberDiscountCode: null })
    expect(document.cookie).toContain("discount_code=ZNM-401")
    expect(screen.getByLabelText("Discount code · optional")).toHaveValue("ZNM-401")
  })

  it.each([
    [{ status: "approved", amount: 30000 }, "TZS 20,000 off the interview fee for each child.", "TZS 30,000"],
    [{ status: "pending", amount: 50000 }, "This code is waiting to be confirmed. The discount applies if it is confirmed before you pay.", "TZS 50,000"],
    [{ status: "unknown", amount: 50000 }, "We don't recognise this code. Check it, or send the form without it.", "TZS 50,000"],
    [{ status: "rate-limited" }, "We couldn't check your code just now. It will still be saved with your application.", "TZS 50,000"],
    [{ status: "unavailable" }, "We couldn't check your code just now. It will still be saved with your application.", "TZS 50,000"],
  ])("checks a typed code when the field loses focus: %j", async (answer, note, fee) => {
    stubs.check.mockResolvedValue(answer)
    const user = await reviewStep({}, 3)
    await user.type(screen.getByLabelText("Discount code · optional"), " abc 123 ")
    await user.tab()

    expect(await screen.findByText(note)).toBeInTheDocument()
    expect(stubs.check).toHaveBeenCalledWith("ABC123")
    const perChild = Number(fee.replace(/\D/g, ""))
    expect(screen.getByText(`${fee} per child`)).toBeInTheDocument()
    expect(screen.getByText(`Total for 3 children: TZS ${(perChild * 3).toLocaleString("en-US")}`)).toBeInTheDocument()
  })

  it("checks again only when the code changed", async () => {
    stubs.check.mockResolvedValue({ status: "unknown", amount: 50000 })
    const user = await reviewStep()
    const field = screen.getByLabelText("Discount code · optional")
    await user.type(field, "QQQ-000")
    await user.tab()
    await screen.findByText(/We don't recognise this code/)
    await user.click(field)
    await user.tab()
    expect(stubs.check).toHaveBeenCalledTimes(1)

    stubs.check.mockResolvedValue({ status: "approved", amount: 30000 })
    await user.clear(field)
    await user.type(field, "BJN-402")
    await user.tab()
    expect(await screen.findByText("TZS 20,000 off the interview fee for each child.")).toBeInTheDocument()
    expect(stubs.check).toHaveBeenCalledTimes(2)
  })

  it("asks again on the next blur when a check couldn't run", async () => {
    stubs.check.mockResolvedValueOnce({ status: "unavailable" }).mockResolvedValueOnce({ status: "approved", amount: 30000 })
    const user = await reviewStep()
    const field = screen.getByLabelText("Discount code · optional")
    await user.type(field, "BJN-402")
    await user.tab()
    await screen.findByText(/We couldn't check your code just now/)
    await user.click(field)
    await user.tab()
    expect(await screen.findByText("TZS 20,000 off the interview fee for each child.")).toBeInTheDocument()
    expect(stubs.check).toHaveBeenCalledTimes(2)
  })

  it("keeps each code's answer when a slower check finishes after a newer one", async () => {
    let finishFirst: (value: unknown) => void = () => {}
    stubs.check
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce({ status: "approved", amount: 30000 })
    const user = await reviewStep()
    const field = screen.getByLabelText("Discount code · optional")
    await user.type(field, "QQQ-000")
    await user.tab()
    await user.clear(field)
    await user.type(field, "BJN-402")
    await user.tab()
    expect(await screen.findByText("TZS 20,000 off the interview fee for each child.")).toBeInTheDocument()

    finishFirst({ status: "unknown", amount: 50000 })
    await screen.findByText("TZS 30,000 per child")
    expect(screen.getByText("TZS 20,000 off the interview fee for each child.")).toBeInTheDocument()
  })

  it("sends whatever code is in the field, recognised or not, and the confirmation shows no fee", async () => {
    stubs.check.mockResolvedValue({ status: "unknown", amount: 50000 })
    stubs.submit.mockResolvedValue({ status: "confirmed", children: [{ fullName: "Zawadi Fixture", admissionNumber: "ADMSN-40719" }] })
    const user = await reviewStep({ discountCode: "BJN-402", rememberDiscountCode: "BJN-402" })
    const field = screen.getByLabelText("Discount code · optional")
    await user.clear(field)
    await user.type(field, "qqq-000")
    await user.click(screen.getByRole("button", { name: "Send application" }))

    const [, sent] = stubs.submit.mock.calls[0] as [unknown, FormData]
    expect(JSON.parse(String(sent.get("form"))).discountCode).toBe("qqq-000")
    expect(await screen.findByRole("heading", { name: "Application received!" })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/TZS|fee/i)
    // Sending leaves the remembered code in place.
    expect(document.cookie).toContain("discount_code=BJN-402")
  })

  it("sends no code when the field is empty", async () => {
    stubs.submit.mockResolvedValue({ status: "unavailable" })
    const user = await reviewStep()
    await user.click(screen.getByRole("button", { name: "Send application" }))
    const [, sent] = stubs.submit.mock.calls[0] as [unknown, FormData]
    expect(JSON.parse(String(sent.get("form")))).not.toHaveProperty("discountCode")
  })

  it("names a value that isn't a code under the field, and won't send it", async () => {
    const user = await reviewStep()
    const field = screen.getByLabelText("Discount code · optional")
    await user.type(field, "ABC_123!")
    await user.click(screen.getByRole("button", { name: "Send application" }))

    expect(screen.getByText(/A discount code has only letters, numbers/)).toBeInTheDocument()
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(stubs.submit).not.toHaveBeenCalled()
    expect(stubs.check).not.toHaveBeenCalled()
  })
})
