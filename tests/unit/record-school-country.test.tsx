import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ savePreviousSchool: vi.fn() }))
vi.mock("@/app/staff/applicants/[id]/sibling-actions", () => ({
  saveFatherName: vi.fn(),
  savePreviousSchool: actions.savePreviousSchool,
  sendSiblingRequest: vi.fn(),
  previewGrant: vi.fn(),
  decideSibling: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { PreviousSchoolRow } from "@/app/staff/applicants/[id]/father-school"
import type { LeadPreviousSchool } from "@/lib/services/lead-details"

// The applicant record's previous school editor (#511, PR 2): the country of
// a school Outside Tanzania, as on the Family page. Another school or a new
// region needs it, filled in with the saved one; private or public alone
// keeps what is saved.

const KENYA: LeadPreviousSchool = { kind: "school", name: "EXAMPLE SCHOOL ABROAD", type: "private", region: "Outside Tanzania", country: "Kenya" }
const OLD: LeadPreviousSchool = { kind: "school", name: "EXAMPLE SCHOOL ABROAD", type: "private", region: "Outside Tanzania" }

const editor = (school: LeadPreviousSchool) => {
  render(<PreviousSchoolRow leadId="lead" className="STD 5" school={school} canEdit onChanged={() => {}} />)
  fireEvent.click(screen.getByRole("button", { name: "Edit previous school" }))
}
const save = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
  })
const rename = (to: string) => fireEvent.change(screen.getByRole("textbox", { name: "School name" }), { target: { value: to } })

beforeEach(() => {
  actions.savePreviousSchool.mockReset().mockResolvedValue({ status: "saved" })
})

describe("PreviousSchoolRow", () => {
  it("shows the country of a school abroad, and fills it in for another school", async () => {
    editor(KENYA)
    expect(screen.getByText("EXAMPLE SCHOOL ABROAD · Private · Kenya")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Country" })).toHaveValue("Kenya")
    rename("ANOTHER SCHOOL ABROAD")
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", { kind: "school", name: "ANOTHER SCHOOL ABROAD", type: "private", region: "Outside Tanzania", country: "Kenya" })
  })

  it("saves another country staff pick", async () => {
    editor(KENYA)
    const country = screen.getByRole("combobox", { name: "Country" })
    await userEvent.clear(country)
    await userEvent.type(country, "uga")
    await userEvent.keyboard("{Enter}")
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", expect.objectContaining({ country: "Uganda" }))
  })

  it("on a school saved before the country list: private or public alone saves, another name asks for the country", async () => {
    editor(OLD)
    fireEvent.click(screen.getByRole("radio", { name: "Public" }))
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", { kind: "school", name: "EXAMPLE SCHOOL ABROAD", type: "public", region: "Outside Tanzania" })

    actions.savePreviousSchool.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Edit previous school" }))
    rename("ANOTHER SCHOOL ABROAD")
    await save()
    expect(actions.savePreviousSchool).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the country from the list.")
  })

  it("drops the country when a region here is chosen", async () => {
    editor(KENYA)
    fireEvent.change(screen.getByRole("textbox", { name: "Find a region" }), { target: { value: "mwanza" } })
    fireEvent.click(screen.getByText("Mwanza"))
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", { kind: "school", name: "EXAMPLE SCHOOL ABROAD", type: "private", region: "Mwanza" })
  })
})
