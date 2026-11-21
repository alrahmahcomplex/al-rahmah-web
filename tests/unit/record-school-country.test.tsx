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
  it("for another school, shows the saved country but saves only once staff pick it again, first in the list", async () => {
    editor(KENYA)
    expect(screen.getByText("EXAMPLE SCHOOL ABROAD · Private · Kenya")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Country" })).toHaveValue("Kenya")
    rename("ANOTHER SCHOOL ABROAD")
    await save()
    expect(actions.savePreviousSchool).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the country again for the new school.")

    await userEvent.click(screen.getByRole("button", { name: "Show all countries" }))
    const first = (await screen.findAllByRole("option"))[0]
    expect(first).toHaveTextContent("Kenya")
    await userEvent.click(first)
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", { kind: "school", name: "ANOTHER SCHOOL ABROAD", type: "private", region: "Outside Tanzania", country: "Kenya" })
  })

  it("private or public alone needs no pick and sends no country, so the record keeps the one stored", async () => {
    editor(KENYA)
    fireEvent.click(screen.getByRole("radio", { name: "Public" }))
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", { kind: "school", name: "EXAMPLE SCHOOL ABROAD", type: "public", region: "Outside Tanzania" })
  })

  it("a pick counts for the school it was made for: renamed again, the country is asked again", async () => {
    editor(KENYA)
    rename("ANOTHER SCHOOL ABROAD")
    await userEvent.click(screen.getByRole("button", { name: "Show all countries" }))
    await userEvent.click((await screen.findAllByRole("option"))[0])
    rename("A THIRD SCHOOL ABROAD")
    await save()
    expect(actions.savePreviousSchool).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the country again for the new school.")
    // Other capitals and spacing are the same school: the pick still counts.
    rename("another  school abroad")
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", expect.objectContaining({ country: "Kenya" }))
  })

  it("a country typed off the list is refused, not saved as the old one", async () => {
    editor(KENYA)
    const country = screen.getByRole("combobox", { name: "Country" })
    await userEvent.clear(country)
    await userEvent.type(country, "Uganada")
    await save()
    expect(actions.savePreviousSchool).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the country from the list.")
  })

  it("the same name in other capitals is the same school: saved as the record holds it", async () => {
    editor({ kind: "school", name: "Example School Abroad", type: "private", region: "Outside Tanzania" })
    rename("EXAMPLE SCHOOL ABROAD")
    fireEvent.click(screen.getByRole("radio", { name: "Public" }))
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", { kind: "school", name: "Example School Abroad", type: "public", region: "Outside Tanzania" })
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
