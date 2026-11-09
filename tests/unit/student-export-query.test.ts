import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { exportOptions } from "@/app/staff/leads/export/options"
import { EXPORT_REFUSALS, parseExportRequest, refusalOf, tooManyMessage } from "@/app/staff/leads/export/parse"
import { exportHref, exportParams, type ExportRequest } from "@/app/staff/leads/export-query"
import { EXPORT_COLUMNS, EXPORT_PRESETS } from "@/lib/services/student-export"

// The export sheet's GET form and the route that reads it: what the sheet
// sends is what the route exports, and nothing else.

const BATCH = "b0000000-0000-4000-8000-000000000001"

function request(overrides: Partial<ExportRequest>): ExportRequest {
  return { preset: "class", choices: [], scope: "shown", search: { closure: "open" }, ...overrides }
}

// Builds the query string as the form would, then reads it back.
function roundTrip(overrides: Partial<ExportRequest>) {
  return parseExportRequest(new URLSearchParams(exportParams(request(overrides))))
}

describe("the export query", () => {
  it("sends the list's own search for the list as filtered now", () => {
    const href = exportHref(
      request({ search: { query: undefined, status: "Visited", closure: "all", earlierLinkYear: 2027, importBatchId: BATCH } }),
    )
    expect(href).toBe(`/staff/leads/export?preset=class&scope=shown&status=Visited&closure=all&earlier_link=2027&import=${BATCH}`)
  })

  it("leaves the list's search out for a year or every applicant", () => {
    expect(exportParams(request({ scope: "year", year: 2027, search: { status: "Visited" } }))).toEqual([
      ["preset", "class"],
      ["scope", "year"],
      ["year", "2027"],
    ])
    expect(exportParams(request({ scope: "all", search: { query: "Amani" } }))).toEqual([
      ["preset", "class"],
      ["scope", "all"],
    ])
  })

  it("sends the ticked choices only for Choose columns", () => {
    expect(exportParams(request({ preset: "custom", choices: ["adm", "phone"] }))).toEqual([
      ["preset", "custom"],
      ["scope", "shown"],
      ["col", "adm"],
      ["col", "phone"],
    ])
    expect(exportParams(request({ preset: "codes", choices: ["adm", "phone"] })).some(([key]) => key === "col")).toBe(false)
  })
})

describe("reading the export query back", () => {
  it("gives a preset its own columns", () => {
    for (const preset of EXPORT_PRESETS.filter((each) => each.key !== "custom")) {
      expect(roundTrip({ preset: preset.key })?.columns).toEqual(preset.columns)
    }
  })

  it("gives Choose columns the ticked choices' columns, in the columns' order", () => {
    expect(roundTrip({ preset: "custom", choices: ["phone", "adm", "ifee"] })?.columns).toEqual([
      "admission_number",
      "guardian_phone",
      "interview_fee_status",
      "interview_fee_amount",
    ])
  })

  it("refuses an unknown preset, Choose columns with nothing ticked, and an unreadable scope", () => {
    expect(roundTrip({ preset: "everything" })).toBeNull()
    expect(roundTrip({ preset: "custom", choices: [] })).toBeNull()
    expect(roundTrip({ preset: "custom", choices: ["password"] })).toBeNull()
    expect(roundTrip({ scope: "year", year: undefined })).toBeNull()
    expect(parseExportRequest(new URLSearchParams("preset=class&scope=year&year=99"))).toBeNull()
    expect(parseExportRequest(new URLSearchParams("preset=class&scope=mine"))).toBeNull()
    expect(parseExportRequest(new URLSearchParams("preset=class"))).toBeNull()
  })

  it("exports the list as filtered now with the screen's filters, the import's included", () => {
    expect(roundTrip({ search: { status: "Enrolled", closure: "Archived", importBatchId: BATCH } })?.filters).toEqual({
      query: undefined,
      status: "Enrolled",
      closure: "Archived",
      earlierLinkYear: undefined,
      importBatchId: BATCH,
    })
    // The list's default: applicants without a closure mark.
    expect(roundTrip({ search: {} })?.filters).toMatchObject({ closure: "open" })
    expect(roundTrip({ search: { query: "ADMSN-12345" } })?.filters).toMatchObject({ query: "ADMSN-12345" })
  })

  it("exports a year or every applicant with closed ones included", () => {
    expect(roundTrip({ scope: "year", year: 2027 })?.filters).toEqual({ closure: "all", enrollmentYear: 2027 })
    expect(roundTrip({ scope: "all" })?.filters).toEqual({ closure: "all" })
  })

  it("drops a search value the list itself would drop", () => {
    const parsed = parseExportRequest(new URLSearchParams("preset=class&scope=shown&status=Maybe&import=not-a-batch"))
    expect(parsed?.filters).toMatchObject({ status: undefined })
    expect(parsed?.filters).not.toHaveProperty("importBatchId")
  })
})

describe("what the export sheet offers", () => {
  const presetKeys = (access: { permissions: string[]; superAdmin: boolean }) => exportOptions(access).presets.map((each) => each.key)

  it("offers leads.view alone the applicant columns only", () => {
    const options = exportOptions({ permissions: ["leads.view"], superAdmin: false })
    expect(options.presets.map((each) => each.key)).toEqual(["class", "codes", "custom"])
    expect(options.tiers).toEqual({ view: true, contact: false, full: false })
  })

  it("adds Follow-up calls with leads.export, and Full data only for the Super Admin", () => {
    expect(presetKeys({ permissions: ["leads.view", "leads.export"], superAdmin: false })).toEqual(["class", "calls", "codes", "custom"])
    expect(presetKeys({ permissions: ["leads.view", "leads.export"], superAdmin: true })).toEqual(["class", "calls", "codes", "full", "custom"])
  })

  it("ticks each preset's columns in Choose columns and counts the CSV's columns", () => {
    const options = exportOptions({ permissions: ["leads.view", "leads.export"], superAdmin: true })
    const preset = (key: string) => options.presets.find((each) => each.key === key)!
    expect(preset("class").choices).toEqual(["adm", "name", "cls", "year", "db", "status"])
    expect(preset("calls").choices).toEqual(["adm", "name", "cls", "status", "since", "pname", "phone", "wa"])
    expect(preset("full").columns).toBe(EXPORT_COLUMNS.length)
    expect(preset("full").tier).toBe("full")
    expect(preset("custom").columns).toBe(0)
    expect(options.choices.find((each) => each.key === "sfee")?.columns).toBe(3)
  })

  it("describes the presets in the applicant words", () => {
    const options = exportOptions({ permissions: ["leads.view", "leads.export"], superAdmin: true })
    for (const preset of options.presets) expect(preset.description).not.toMatch(/\blead/i)
  })
})

describe("the route's refusals", () => {
  it("answers each refusal with its status", () => {
    expect(refusalOf({ kind: "forbidden" })).toEqual({ status: 403, text: EXPORT_REFUSALS.forbidden })
    expect(refusalOf({ kind: "invalid" })).toEqual({ status: 400, text: EXPORT_REFUSALS.invalid })
    expect(refusalOf({ kind: "unavailable" })).toEqual({ status: 503, text: EXPORT_REFUSALS.unavailable })
    expect(refusalOf({ kind: "too-many", rowCount: 5200 })).toEqual({ status: 413, text: tooManyMessage(5200) })
  })

  it("names the cap, and the count when the database gave it", () => {
    expect(tooManyMessage(5200)).toBe(
      "More applicants match (5,200) than one export holds, 5,000. Export one Enrollment year at a time, or filter the list first.",
    )
    expect(tooManyMessage(null)).toBe(
      "More applicants match than one export holds, 5,000. Export one Enrollment year at a time, or filter the list first.",
    )
  })
})
