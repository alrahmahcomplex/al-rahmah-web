import { describe, expect, it } from "vitest"

import {
  CONFIRM_LOST,
  changedTitle,
  createLabel,
  doneTitle,
  importErrorMessage,
  rowsChecked,
  skippedFileName,
  skippedFileRows,
  skippedRowsLabel,
  summaryChips,
  toCreate,
} from "@/app/staff/applicants/import-messages"
import { importNote } from "@/app/staff/applicants/[id]/history/import-history"
import { describeLeadHistory } from "@/app/staff/applicants/[id]/history/describe"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import type { StudentImportSummary } from "@/lib/student-import"

// The applicant import sheet's words: refusals, the review's chips and
// counts, the Done title, and the history line an imported lead gets.

function summary(counts: Partial<Record<"create" | "joins-family" | "present" | "flagged" | "refused", number>>): StudentImportSummary {
  const full = { create: 0, "joins-family": 0, present: 0, flagged: 0, refused: 0, ...counts }
  const total = Object.values(full).reduce((a, b) => a + b, 0)
  return { ...full, total, skipped: total - full.create - full["joins-family"] }
}

describe("the review's counts", () => {
  const file = summary({ create: 3, "joins-family": 1, present: 1, flagged: 1, refused: 1 })

  it("creates the new rows and those joining a family", () => {
    expect(toCreate(file)).toBe(4)
    expect(createLabel(file)).toBe("Create 4 applicants")
    expect(createLabel(summary({ "joins-family": 1 }))).toBe("Create 1 applicant")
  })

  it("puts only refused and flagged rows in the skipped file, not those already present", () => {
    expect(skippedFileRows(file)).toBe(2)
    expect(skippedRowsLabel(2)).toBe("Download the 2 skipped rows")
    expect(skippedRowsLabel(1)).toBe("Download the 1 skipped row")
    expect(skippedFileName("referrals-2027.csv")).toBe("referrals-2027-skipped.csv")
    expect(skippedFileName("Workbook.CSV")).toBe("Workbook-skipped.csv")
  })

  it("shows a chip for each class the file has, in the prototype's order", () => {
    expect(summaryChips(file).map((chip) => chip.label)).toEqual([
      "3 to create",
      "1 joins a family",
      "1 already present",
      "1 flagged",
      "1 refused",
    ])
    expect(summaryChips(summary({ create: 2, "joins-family": 2 })).map((chip) => chip.label)).toEqual(["2 to create", "2 join a family"])
  })

  it("counts the rows checked", () => {
    expect(rowsChecked(1)).toBe("1 row checked")
    expect(rowsChecked(1200)).toBe("1,200 rows checked")
  })
})

describe("the Done step", () => {
  it("counts those that joined a family among the applicants created", () => {
    expect(doneTitle({ created: 3, joinedFamily: 1, skipped: 3 })).toBe("4 applicants created, 1 joined a family, 3 skipped.")
    expect(doneTitle({ created: 1, joinedFamily: 0, skipped: 0 })).toBe("1 applicant created, 0 joined a family, 0 skipped.")
  })

  it("says how many rows changed when confirm finds them", () => {
    expect(changedTitle(1)).toBe("1 row changed since you checked, so nothing was saved")
    expect(changedTitle(3)).toBe("3 rows changed since you checked, so nothing was saved")
  })
})

describe("the import's refusals", () => {
  it("are bilingual for a file problem", () => {
    const message = importErrorMessage({ kind: "file", error: { kind: "missing-columns", columns: ["Student name"] } })
    expect(message.en).toContain("Student name")
    expect(message.sw).toBeTruthy()
  })

  it("say who may import, without the word lead", () => {
    for (const kind of ["signed-out", "forbidden", "invalid", "nothing-to-import", "unavailable"] as const) {
      expect(importErrorMessage({ kind }).en).not.toMatch(/\blead/i)
    }
    expect(importErrorMessage({ kind: "forbidden" }).en).toBe("Only staff who may import applicants can do this.")
  })

  it("tell the person a lost confirm may have saved, and how to settle it", () => {
    expect(importErrorMessage({ kind: "uncertain" })).toBe(CONFIRM_LOST)
    expect(CONFIRM_LOST.en).toContain("Already present")
  })
})

function entry(overrides: Partial<LeadHistoryEntry>): LeadHistoryEntry {
  return { id: 1, at: "2026-11-09T11:00:00Z", actor: "Test Manager", record: "lead", recordId: "l1", action: "insert", changes: [], ...overrides }
}

describe("the history of an imported lead", () => {
  const created = entry({
    changes: [
      { field: "student_name", from: null, to: "Amani Mfano" },
      { field: "import_batch_id", from: null, to: "b0000000-0000-4000-8000-000000000001" },
      { field: "enrolled_by_import", from: null, to: true },
    ],
  })

  it("names the file on the creation entry, and only there", () => {
    expect(importNote(created, "workbook.csv")).toBe("Created by the workbook import (workbook.csv)")
    expect(importNote(created, null)).toBe("Created by the workbook import")
    expect(importNote(entry({ changes: [{ field: "student_name", from: null, to: "Amani" }] }), "workbook.csv")).toBeUndefined()
    expect(importNote(entry({ action: "update", changes: created.changes }), "workbook.csv")).toBeUndefined()
  })

  it("hides the batch id and labels the Enrolled mark", () => {
    const [described] = describeLeadHistory([created], {}, "workbook.csv")
    expect(described.note).toBe("Created by the workbook import (workbook.csv)")
    expect(described.changes.map((change) => change.label)).toEqual(["Student name", "Enrolled by the import, payments not recorded"])
  })

  it("leaves a lead the import did not create as it was", () => {
    const [described] = describeLeadHistory([entry({ changes: [{ field: "student_name", from: null, to: "Amani" }] })], {})
    expect(described).not.toHaveProperty("note")
  })
})
