import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ savePreviousSchool: vi.fn() }))
vi.mock("@/app/staff/applicants/[id]/sibling-actions", () => ({
  saveFatherName: vi.fn(),
  savePreviousSchool: actions.savePreviousSchool,
  sendSiblingRequest: vi.fn(),
  previewGrant: vi.fn(),
  decideSibling: vi.fn(),
}))
vi.mock("@/app/staff/applicants/[id]/actions", () => ({ correctStudent: vi.fn(), correctContact: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { SchoolSheet } from "@/app/staff/family/detail-sheets"
import type { LeadPreviousSchool } from "@/lib/services/lead-details"

// Previous school sheet on the Family page (#512): type-ahead region and
// country lists, with country required when Outside Tanzania is chosen.

function Sheet({ school }: { school: LeadPreviousSchool }) {
  const [open, setOpen] = useState(true)
  return <SchoolSheet leadId="lead" studentName="NEEMA JUMA MRISHO" school={school} open={open} onOpenChange={setOpen} />
}

const sheet = () => screen.getByRole("dialog", { name: "Previous school" })
const save = () =>
  act(async () => {
    fireEvent.click(within(sheet()).getByRole("button", { name: "Save" }))
  })

beforeEach(() => {
  actions.savePreviousSchool.mockReset().mockResolvedValue({ status: "saved" })
})

describe("SchoolSheet", () => {
  it("requires a country for Outside Tanzania and saves it when chosen", async () => {
    render(<Sheet school={{ kind: "school", name: "EXAMPLE PRIMARY SCHOOL", type: "public", region: "Dar es Salaam" }} />)

    const region = within(sheet()).getByRole("combobox", { name: "Region" })
    fireEvent.change(region, { target: { value: "Outside Tanzania (Other Country)" } })
    await save()

    expect(within(sheet()).getByRole("alert")).toHaveTextContent("Choose the country from the list.")
    expect(actions.savePreviousSchool).not.toHaveBeenCalled()

    const country = within(sheet()).getByRole("combobox", { name: "Country" })
    fireEvent.change(country, { target: { value: "Kenya" } })
    await save()

    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", {
      kind: "school",
      name: "EXAMPLE PRIMARY SCHOOL",
      type: "public",
      region: "Outside Tanzania",
      country: "Kenya",
    })
  })

  it("drops the country when switching from Outside Tanzania to a Tanzanian region", async () => {
    render(<Sheet school={{ kind: "school", name: "GREEN HILLS", type: "private", region: "Outside Tanzania", country: "Kenya" }} />)

    expect(within(sheet()).getByRole("combobox", { name: "Country" })).toHaveValue("Kenya")
    fireEvent.change(within(sheet()).getByRole("combobox", { name: "Region" }), { target: { value: "Arusha" } })
    await save()

    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", {
      kind: "school",
      name: "GREEN HILLS",
      type: "private",
      region: "Arusha",
    })
  })

  it("keeps the sheet open while picking from the portaled TypeAheadField list and on Escape", async () => {
    render(<Sheet school={{ kind: "school", name: "EXAMPLE PRIMARY SCHOOL", type: "public", region: "Dar es Salaam" }} />)

    fireEvent.click(within(sheet()).getByRole("button", { name: "Show all regions" }))
    const list = await screen.findByRole("listbox", { name: "Regions" })
    const search = screen.getByRole("combobox", { name: "Search regions" })
    fireEvent.keyDown(search, { key: "Escape" })
    expect(screen.queryByRole("listbox", { name: "Regions" })).toBeNull()
    expect(sheet()).toBeInTheDocument()

    fireEvent.click(within(sheet()).getByRole("button", { name: "Show all regions" }))
    fireEvent.click(within(await screen.findByRole("listbox", { name: "Regions" })).getByRole("option", { name: "Outside Tanzania (Other Country)" }))
    expect(sheet()).toBeInTheDocument()
    expect(within(sheet()).getByRole("combobox", { name: "Region" })).toHaveValue("Outside Tanzania (Other Country)")
    expect(list).not.toBeInTheDocument()
  })

  it("keeps the sheet open when Escape dismisses a faint suggestion inside the box, and keeps country while retyping Outside Tanzania", async () => {
    render(<Sheet school={{ kind: "school", name: "GREEN HILLS", type: "private", region: "Outside Tanzania", country: "Kenya" }} />)

    const country = within(sheet()).getByRole("combobox", { name: "Country" })
    fireEvent.focus(country)
    fireEvent.change(country, { target: { value: "Uga" } })
    fireEvent.keyDown(country, { key: "Escape" })
    expect(sheet()).toBeInTheDocument()
    fireEvent.change(country, { target: { value: "Kenya" } })

    const region = within(sheet()).getByRole("combobox", { name: "Region" })
    fireEvent.change(region, { target: { value: "Outside Tanzania (Other Countr" } })
    fireEvent.change(region, { target: { value: "Outside Tanzania (Other Country)" } })
    expect(within(sheet()).getByRole("combobox", { name: "Country" })).toHaveValue("Kenya")
  })

  it("for another school, saves the saved country only once staff pick it again (#511)", async () => {
    render(<Sheet school={{ kind: "school", name: "GREEN HILLS", type: "private", region: "Outside Tanzania", country: "Kenya" }} />)
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "School name" }), { target: { value: "BLUE HILLS" } })
    await save()
    expect(actions.savePreviousSchool).not.toHaveBeenCalled()
    expect(within(sheet()).getByRole("alert")).toHaveTextContent("Choose the country again for the new school.")

    fireEvent.click(within(sheet()).getByRole("button", { name: "Show all countries" }))
    const first = within(await screen.findByRole("listbox", { name: "Countries" })).getAllByRole("option")[0]
    expect(first).toHaveTextContent("Kenya")
    fireEvent.click(first)
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", { kind: "school", name: "BLUE HILLS", type: "private", region: "Outside Tanzania", country: "Kenya" })
  })

  it("refuses a country typed off the list instead of keeping the old one (#511)", async () => {
    render(<Sheet school={{ kind: "school", name: "GREEN HILLS", type: "private", region: "Outside Tanzania", country: "Kenya" }} />)
    fireEvent.change(within(sheet()).getByRole("combobox", { name: "Country" }), { target: { value: "Uganada" } })
    await save()
    expect(actions.savePreviousSchool).not.toHaveBeenCalled()
    expect(within(sheet()).getByRole("alert")).toHaveTextContent("Choose the country from the list.")
  })

  it("saves private or public alone on an old school abroad with no country, keeping its name as stored (#511)", async () => {
    render(<Sheet school={{ kind: "school", name: "Green Hills", type: "private", region: "Outside Tanzania" }} />)
    fireEvent.click(within(sheet()).getByRole("radio", { name: "Public" }))
    await save()
    expect(actions.savePreviousSchool).toHaveBeenCalledWith("lead", { kind: "school", name: "Green Hills", type: "public", region: "Outside Tanzania" })
  })
})
