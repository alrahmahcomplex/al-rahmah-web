import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/staff/check-in/new/actions", () => ({ findCustodianFamily: vi.fn().mockResolvedValue({ status: "none" }) }))
vi.mock("@/app/staff/check-in/new/code-actions", () => ({ listCodesToPick: vi.fn() }))
vi.mock("@/app/staff/applicants/[id]/referral-actions", () => ({ lookUpReferralCode: vi.fn() }))

import { CustodianQuestion, NameQuestion, SchoolQuestion } from "@/app/staff/check-in/new/questions"

// The student's name, previous school, and custodian questions (#511, PR 2).

const PREFILL = { firstName: "YUSUF", fatherFirst: "ALI", fatherMiddle: "OMARI", fatherLast: "HASSAN", lastNameFrom: "father_middle" as const }

describe("NameQuestion", () => {
  it("shows and saves the name the choice builds when reopened and sent unchanged", async () => {
    const onDone = vi.fn()
    render(<NameQuestion id="n" next={false} saved={PREFILL} onDone={onDone} />)
    expect(screen.getByText("YUSUF ALI OMARI")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith(PREFILL)
  })

  it("keeps the choice when a box is corrected", async () => {
    const onDone = vi.fn()
    render(<NameQuestion id="n" next={false} saved={PREFILL} onDone={onDone} />)
    const first = screen.getByRole("textbox", { name: "Student’s name" })
    await userEvent.clear(first)
    await userEvent.type(first, "yusufu")
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ ...PREFILL, firstName: "YUSUFU" })
  })

  it("starts with the father's last name and lets staff pick his middle name", async () => {
    const onDone = vi.fn()
    render(<NameQuestion id="n" next={false} saved={{ ...PREFILL, lastNameFrom: undefined }} onDone={onDone} />)
    expect(screen.getByText("YUSUF ALI HASSAN")).toBeInTheDocument()
    const group = screen.getByRole("radiogroup", { name: "Student’s last name" })
    expect(within(group).getByRole("radio", { name: /Father’s last name\s*HASSAN/ })).toBeChecked()
    await userEvent.click(within(group).getByRole("radio", { name: /Father’s middle name\s*OMARI/ }))
    expect(screen.getByText("YUSUF ALI OMARI")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith(PREFILL)
  })
})

describe("SchoolQuestion", () => {
  const ABROAD = { name: "EXAMPLE SCHOOL ABROAD", type: "private" as const, region: "Outside Tanzania", country: "Kenya" }

  it("types the school name in capitals and takes a region and country with type-ahead", async () => {
    const onDone = vi.fn()
    render(<SchoolQuestion id="s" first="YUSUF" onDone={onDone} onNotKnown={() => {}} />)
    await userEvent.type(screen.getByRole("textbox", { name: "School name" }), "green hills academy")
    expect(screen.getByRole("textbox", { name: "School name" })).toHaveValue("GREEN HILLS ACADEMY")
    await userEvent.click(screen.getByRole("radio", { name: "Private" }))
    const region = screen.getByRole("combobox", { name: "Region" })
    await userEvent.type(region, "out")
    await userEvent.tab()
    expect(region).toHaveValue("Outside Tanzania (Other Country)")
    const country = screen.getByRole("combobox", { name: "Country" })
    expect(country).toHaveFocus()
    await userEvent.type(country, "ken")
    await userEvent.keyboard("{Enter}")
    expect(country).toHaveValue("Kenya")
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ name: "GREEN HILLS ACADEMY", type: "private", region: "Outside Tanzania", country: "Kenya" })
  })

  it("keeps the saved country when the same school is confirmed unchanged", async () => {
    const onDone = vi.fn()
    render(<SchoolQuestion id="s" first="YUSUF" saved={ABROAD} onDone={onDone} onNotKnown={() => {}} />)
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith(ABROAD)
  })

  it("drops the country when the region changes to one in Tanzania", async () => {
    const onDone = vi.fn()
    render(<SchoolQuestion id="s" first="YUSUF" saved={ABROAD} onDone={onDone} onNotKnown={() => {}} />)
    const region = screen.getByRole("combobox", { name: "Region" })
    await userEvent.clear(region)
    await userEvent.type(region, "pw")
    await userEvent.keyboard("{Enter}")
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ name: ABROAD.name, type: "private", region: "Pwani" })
  })

  it("prompts for the country on an old Outside Tanzania school that has none", async () => {
    const onDone = vi.fn()
    render(
      <SchoolQuestion
        id="s"
        first="YUSUF"
        saved={{ name: ABROAD.name, type: "private", region: "Outside Tanzania" }}
        needsCountry
        onDone={onDone}
        onNotKnown={() => {}}
      />,
    )
    expect(screen.getByText(/no country saved yet/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Continue/ }).closest("[inert]")).not.toBeNull()
    const country = screen.getByRole("combobox", { name: "Country" })
    await userEvent.type(country, "uga")
    await userEvent.keyboard("{Enter}")
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ name: ABROAD.name, type: "private", region: "Outside Tanzania", country: "Uganda" })
  })
})

describe("SchoolQuestion at check-in, round 2 of #526", () => {
  const OLD = { name: "IS", type: "private" as const, region: "Outside Tanzania" }

  it("takes a two-letter school name, as the database does", async () => {
    const onDone = vi.fn()
    render(<SchoolQuestion id="s" first="YUSUF" saved={OLD} needsCountry onDone={onDone} onNotKnown={() => {}} />)
    await userEvent.type(screen.getByRole("combobox", { name: "Country" }), "uga")
    await userEvent.keyboard("{Enter}")
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ ...OLD, country: "Uganda" })
  })

  it("saves private or public alone on an old school abroad with no country", async () => {
    const onDone = vi.fn()
    render(<SchoolQuestion id="s" first="YUSUF" saved={OLD} needsCountry onDone={onDone} onNotKnown={() => {}} />)
    await userEvent.click(screen.getByRole("radio", { name: "Public" }))
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ name: "IS", type: "public", region: "Outside Tanzania" })
  })

  it("keeps the saved country while staff retype Outside Tanzania in the region box", async () => {
    const ABROAD = { name: "EXAMPLE SCHOOL ABROAD", type: "private" as const, region: "Outside Tanzania", country: "Kenya" }
    const onDone = vi.fn()
    render(<SchoolQuestion id="s" first="YUSUF" saved={ABROAD} onDone={onDone} onNotKnown={() => {}} />)
    const region = screen.getByRole("combobox", { name: "Region" })
    await userEvent.clear(region)
    await userEvent.type(region, "outs")
    await userEvent.keyboard("{Enter}")
    expect(screen.getByRole("combobox", { name: "Country" })).toHaveValue("Kenya")
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith(ABROAD)
  })

  it("for another school, the saved country counts only once picked again", async () => {
    const ABROAD = { name: "EXAMPLE SCHOOL ABROAD", type: "private" as const, region: "Outside Tanzania", country: "Kenya" }
    const onDone = vi.fn()
    render(<SchoolQuestion id="s" first="YUSUF" saved={ABROAD} onDone={onDone} onNotKnown={() => {}} />)
    const name = screen.getByRole("textbox", { name: "School name" })
    await userEvent.clear(name)
    await userEvent.type(name, "another school")
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByText("Choose the country again for the new school.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Show all countries" }))
    await userEvent.click((await screen.findAllByRole("option"))[0])
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ ...ABROAD, name: "ANOTHER SCHOOL" })
  })

  it("Not known yet answers in one press, with no warning, on an old school abroad with no country", async () => {
    const onNotKnown = vi.fn()
    render(<SchoolQuestion id="s" first="YUSUF" saved={OLD} needsCountry onDone={() => {}} onNotKnown={onNotKnown} />)
    await userEvent.click(screen.getByRole("button", { name: "Not known yet" }))
    expect(onNotKnown).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/off the record/)).toBeNull()
  })

  it("keeps the caret in the school's name when staff go back to it before the region box opens", async () => {
    render(<SchoolQuestion id="s" first="YUSUF" onDone={() => {}} onNotKnown={() => {}} />)
    const name = screen.getByRole("textbox", { name: "School name" })
    await userEvent.type(name, "green hills")
    await userEvent.click(screen.getByRole("radio", { name: "Private" }))
    await userEvent.click(name)
    await new Promise((r) => setTimeout(r, 450))
    expect(name).toHaveFocus()
  })
})

describe("SchoolQuestion focus, round 3 of #526", () => {
  it("keeps typing in the region list's search when staff open it before the planned focus", async () => {
    render(<SchoolQuestion id="s" first="YUSUF" onDone={() => {}} onNotKnown={() => {}} />)
    await userEvent.type(screen.getByRole("textbox", { name: "School name" }), "green hills")
    await userEvent.click(screen.getByRole("radio", { name: "Private" }))
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    const search = await screen.findByRole("combobox", { name: "Search regions" })
    search.focus()
    await new Promise((r) => setTimeout(r, 450))
    expect(search).toHaveFocus()
  })
})

describe("CustodianQuestion", () => {
  const base = { id: "c1", names: "YUSUF", father: "ALI OMARI HASSAN", first: null, canCheck: false, otherFather: null }

  it("starts with two big choices and reveals only the father's phone when The father is picked", async () => {
    const onDone = vi.fn()
    render(<CustodianQuestion {...base} onDone={onDone} />)
    expect(screen.getByRole("textbox", { name: "Custodian’s mobile number" }).closest("[inert]")).not.toBeNull()
    await userEvent.click(screen.getByRole("radio", { name: /The father\s*ALI OMARI HASSAN/ }))
    const phone = screen.getByRole("textbox", { name: "Custodian’s mobile number" })
    expect(phone.closest("[inert]")).toBeNull()
    await userEvent.type(phone, "0712345678")
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ kind: "father", phone: "0712345678", whatsapp: "", contact: undefined })
  })

  it("shows name boxes and mobile, then relationship when Someone else is picked", async () => {
    const onDone = vi.fn()
    render(<CustodianQuestion {...base} onDone={onDone} />)
    await userEvent.click(screen.getByRole("radio", { name: /Someone else\s*Mother, guardian/ }))
    const firstName = screen.getByRole("textbox", { name: "First name" })
    expect(firstName.closest("[inert]")).toBeNull()
    await userEvent.type(firstName, "saida")
    await userEvent.type(screen.getByRole("textbox", { name: "Middle name" }), "omari")
    await userEvent.type(screen.getByRole("textbox", { name: "Last name" }), "hassan")
    await userEvent.type(screen.getByRole("textbox", { name: "Custodian’s mobile number" }), "0712345678")
    await userEvent.click(screen.getByRole("radio", { name: "Mother" }))
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({
      kind: "new",
      name: { firstName: "SAIDA", middleName: "OMARI", lastName: "HASSAN" },
      phone: "0712345678",
      whatsapp: "",
      relationship: "Mother",
      description: "",
    })
  })

  it("keeps focus where staff put it when they move to a box before the boxes open", async () => {
    render(<CustodianQuestion {...base} onDone={() => {}} />)
    await userEvent.click(screen.getByRole("radio", { name: /Someone elses*Mother, guardian/ }))
    const middle = screen.getByRole("textbox", { name: "Middle name" })
    await userEvent.click(middle)
    await new Promise((r) => setTimeout(r, 450))
    expect(middle).toHaveFocus()
  })

  it("from the second household on, a hidden name or the father's number never stands in for someone else's", async () => {
    const onDone = vi.fn()
    render(<CustodianQuestion {...base} first={{ name: "AMINA JUMA SAID" }} onDone={onDone} />)
    const someoneElse = () => screen.getByRole("radio", { name: /Someone elses*Mother, guardian/ })
    const another = () => screen.getByRole("radio", { name: /Someone elses*Take their own name/ })
    const mobile = () => screen.getByRole("textbox", { name: "Custodian’s mobile number" })
    await userEvent.click(someoneElse())
    await userEvent.click(another())
    await userEvent.type(screen.getByRole("textbox", { name: "First name" }), "saida")
    await userEvent.type(screen.getByRole("textbox", { name: "Middle name" }), "omari")
    await userEvent.type(screen.getByRole("textbox", { name: "Last name" }), "hassan")
    await userEvent.type(mobile(), "0755000222")

    // The father, with his own number: the guardian's number doesn't follow.
    await userEvent.click(screen.getByRole("radio", { name: /The fathers*ALI OMARI HASSAN/ }))
    expect(mobile()).toHaveValue("")
    await userEvent.type(mobile(), "0712345678")

    // Back to Someone else: nothing is accepted until staff say which person it is.
    await userEvent.click(someoneElse())
    expect(screen.getByRole("radio", { name: "Mother" }).closest("[inert]")).not.toBeNull()
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByText("Say whether it is AMINA JUMA SAID or someone else.")).toBeInTheDocument()

    // Picked again, the guardian comes back with her own number.
    await userEvent.click(another())
    expect(mobile()).toHaveValue("0755000222")
    await userEvent.click(screen.getByRole("radio", { name: "Mother" }))
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({
      kind: "new",
      name: { firstName: "SAIDA", middleName: "OMARI", lastName: "HASSAN" },
      phone: "0755000222",
      whatsapp: "",
      relationship: "Mother",
      description: "",
    })
    // Much typing: give a busy machine time.
  }, 15_000)

  it("at check-in, back to Someone else brings staff's own relationship back, not the form's", async () => {
    render(
      <CustodianQuestion
        {...base}
        prefill={{
          contact: { id: "c-form", fullName: "SAIDA OMARI HASSAN", phone: "+255755000222", whatsapp: null, children: [] },
          relationship: "Mother",
          description: null,
        }}
        onDone={() => {}}
      />,
    )
    const mobile = screen.getByRole("textbox", { name: "Custodian’s mobile number" })
    await userEvent.clear(mobile)
    await userEvent.type(mobile, "0712345678")
    await userEvent.click(screen.getByRole("radio", { name: "Guardian" }))
    await userEvent.click(screen.getByRole("radio", { name: /The fathers*ALI OMARI HASSAN/ }))
    await userEvent.click(screen.getByRole("radio", { name: /Someone elses*Mother, guardian/ }))
    expect(screen.getByRole("textbox", { name: "Custodian’s mobile number" })).toHaveValue("0712345678")
    expect(screen.getByRole("radio", { name: "Guardian" })).toBeChecked()
    expect(screen.getByRole("radio", { name: "Mother" })).not.toBeChecked()
  })

  it("opens on Someone else at check-in when the Admission form named a custodian", () => {
    render(
      <CustodianQuestion
        {...base}
        prefill={{
          contact: { id: "c-form", fullName: "SAIDA OMARI HASSAN", phone: "+255755000222", whatsapp: null, children: [] },
          relationship: "Mother",
          description: null,
        }}
        onDone={() => {}}
      />,
    )
    expect(screen.getByRole("radio", { name: /Someone else\s*Mother, guardian/ })).toBeChecked()
    expect(screen.getByRole("radio", { name: "Mother" })).toBeChecked()
  })
})
