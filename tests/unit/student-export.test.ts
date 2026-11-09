import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  EXPORT_CHOICES,
  EXPORT_COLUMNS,
  EXPORT_PRESETS,
  EXPORT_ROW_CAP,
  cellText,
  columnsForChoices,
  exportFileName,
  filtersFromSearch,
  holdsTier,
  studentsCsv,
  tierNeeded,
} from "@/lib/services/student-export"

// The export's columns, presets and CSV, without the database.

describe("the export columns", () => {
  it("are the contract's, each in one tier", () => {
    const byTier = (tier: string) => EXPORT_COLUMNS.filter((column) => column.tier === tier).map((column) => column.key)
    expect(byTier("view")).toEqual([
      "admission_number",
      "student_name",
      "class_name",
      "enrollment_year",
      "day_or_boarding",
      "status",
      "status_since",
      "visit_date",
      "discount_code",
      "discount_holder",
      "pre_form_one",
      "imported",
    ])
    expect(byTier("contact")).toEqual(["guardian_name", "relationship", "guardian_phone", "guardian_whatsapp"])
    expect(byTier("full")).toHaveLength(12)
  })

  it("group into the prototype's checkboxes, each column once", () => {
    const grouped = EXPORT_CHOICES.flatMap((choice) => choice.columns)
    expect(new Set(grouped).size).toBe(grouped.length)
    for (const choice of EXPORT_CHOICES) {
      for (const column of choice.columns) expect(EXPORT_COLUMNS.find((c) => c.key === column)?.tier, column).toBe(choice.tier)
    }
    expect(columnsForChoices(["phone", "adm", "pname"])).toEqual(["admission_number", "guardian_name", "guardian_phone"])
  })

  it("make presets that need the tier they show", () => {
    const need = Object.fromEntries(EXPORT_PRESETS.filter((p) => p.columns.length > 0).map((p) => [p.key, tierNeeded(p.columns)]))
    expect(need).toEqual({ class: "view", calls: "contact", codes: "view", full: "full" })
  })

  it("show a tier only to whoever the database gives it", () => {
    const staff = { permissions: ["leads.view"], superAdmin: false }
    const manager = { permissions: ["leads.view", "leads.export"], superAdmin: false }
    const owner = { permissions: ["leads.view", "leads.export"], superAdmin: true }
    expect([holdsTier("view", staff), holdsTier("contact", staff), holdsTier("full", staff)]).toEqual([true, false, false])
    expect([holdsTier("contact", manager), holdsTier("full", manager)]).toEqual([true, false])
    expect(holdsTier("full", owner)).toBe(true)
  })
})

describe("the CSV", () => {
  it("writes yes and no, dates at the school, and nothing for empty values", () => {
    expect(cellText("imported", true)).toBe("yes")
    expect(cellText("pre_form_one", false)).toBe("no")
    expect(cellText("status_since", "2026-11-08T22:30:00+00:00")).toBe("2026-11-09")
    expect(cellText("interview_score", 72.5)).toBe("72.5")
    expect(cellText("guardian_whatsapp", null)).toBe("")
  })

  it("names the headers and guards formulas", () => {
    const csv = studentsCsv({ columns: ["admission_number", "student_name"], rows: [["ADMSN-90001", "=HYPERLINK(1)"]] })
    expect(csv).toBe("Admission Number,Student name\r\nADMSN-90001,'=HYPERLINK(1)\r\n")
  })

  it("is named for its preset and the day at the school", () => {
    expect(exportFileName("calls", new Date("2026-11-08T22:30:00Z"))).toBe("students-calls-2026-11-09.csv")
  })

  it("caps one export at 5000 students, as the database does", () => {
    expect(EXPORT_ROW_CAP).toBe(5000)
  })

  it("exports the list as the screen filters it", () => {
    expect(filtersFromSearch({ query: "Asha", status: "Visited", closure: "all", earlierLinkYear: 2027 })).toEqual({
      query: "Asha",
      status: "Visited",
      closure: "all",
      earlierLinkYear: 2027,
    })
  })
})
