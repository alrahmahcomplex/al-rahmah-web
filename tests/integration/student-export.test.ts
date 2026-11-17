import { randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { EXPORT_COLUMNS, EXPORT_PRESETS, exportStudents, studentsCsv, type ExportColumn } from "@/lib/services/student-export"

import { anonClient, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { leadWithCode } from "../support/discount-codes"
import { ADMISSIONS, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// The student export (owner decisions of 2026-11-09): view columns for
// leads.view, contact columns for leads.export, full columns for the Super
// Admin alone. Every export is recorded in export_log. The 5000-student
// limit is in serial/student-export-limit.test.ts (#438).

const VIEW: ExportColumn[] = ["admission_number", "student_name", "class_name", "status", "discount_code", "imported"]
const CONTACT: ExportColumn[] = ["admission_number", "guardian_name", "guardian_phone", "guardian_whatsapp"]
const FULL: ExportColumn[] = ["admission_number", "interview_fee_status", "interview_fee_amount", "history_count", "closure"]

async function oneLead() {
  const name = `Export Kid ${randomUUID().slice(0, 8)}`
  const leadId = await leadWithCode(null, name)
  const admissionNumber = await inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ admission_number: string }>("select admission_number from public.leads where id = $1", [leadId])
    return rows[0].admission_number
  })
  return { leadId, name, admissionNumber }
}

async function logsOf(staffId: string, since: Date) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ columns: string[]; row_count: number; filters: Record<string, unknown>; kind: string }>(
      "select columns, row_count, filters, kind from public.export_log where exported_by = $1 and exported_at >= $2 order by exported_at",
      [staffId, since],
    )
    return rows
  })
}

describe("export tiers", () => {
  test("Staff with leads.view get the view columns, never the contact or full ones", async () => {
    const lead = await oneLead()
    const admissions = await signedIn(ADMISSIONS)
    const since = new Date(Date.now() - 1000)
    const result = await exportStudents(admissions, { query: lead.admissionNumber }, VIEW)
    expect(result).toEqual({
      ok: true,
      data: { columns: VIEW, rows: [[lead.admissionNumber, lead.name, "STD 3", "Visited", "", "no"]], rowCount: 1 },
    })
    expect(await exportStudents(admissions, { query: lead.admissionNumber }, CONTACT)).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await exportStudents(admissions, { query: lead.admissionNumber }, FULL)).toEqual({ ok: false, error: { kind: "forbidden" } })
    // Only the export that happened is recorded.
    expect(await logsOf(ADMISSIONS.id, since)).toEqual([
      { kind: "students", columns: VIEW, row_count: 1, filters: { query: lead.admissionNumber } },
    ])
  })

  test("a Manager with leads.export gets the contact columns, never the full ones", async () => {
    const lead = await oneLead()
    const manager = await signedIn(MANAGER)
    const result = await exportStudents(manager, { query: lead.admissionNumber }, CONTACT)
    expect(result.ok && result.data.rows).toEqual([[lead.admissionNumber, "Mzazi Punguzo", expect.stringMatching(/^\+2558\d{8}$/), ""]])
    expect(await exportStudents(manager, { query: lead.admissionNumber }, FULL)).toEqual({ ok: false, error: { kind: "forbidden" } })
  })

  test("the Super Admin gets every column, and the export is in the audit history", async () => {
    const lead = await oneLead()
    const all = EXPORT_PRESETS.find((preset) => preset.key === "full")!.columns
    const result = await exportStudents(await signedIn(SUPER_ADMIN), { query: lead.admissionNumber }, all)
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.data.columns).toEqual(EXPORT_COLUMNS.map((column) => column.key))
    const row = Object.fromEntries(result.data.columns.map((column, i) => [column, result.data.rows[0][i]]))
    expect(row).toMatchObject({ admission_number: lead.admissionNumber, interview_fee_status: "", closure: "", imported: "no" })
    expect(Number(row.history_count)).toBeGreaterThan(0)
    const csv = studentsCsv(result.data)
    expect(csv.split("\r\n")[0]).toBe(EXPORT_COLUMNS.map((column) => column.header).join(","))

    const audit = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ scope: string; actor_staff_id: string }>(
        "select scope, actor_staff_id from public.audit_log where table_name = 'export_log' and actor_staff_id = $1 order by created_at desc limit 1",
        [SUPER_ADMIN.id],
      )
      return rows[0]
    })
    expect(audit).toEqual({ scope: "staff_admin", actor_staff_id: SUPER_ADMIN.id })
  })

  test("refuses unknown and repeated columns, a signed-out visitor, and staff without leads.view", async () => {
    const admissions = await signedIn(ADMISSIONS)
    const unknown = await admissions.rpc("export_leads", { filters: {}, columns: ["admission_number", "salary"] })
    expect(unknown.error?.message).toBe("invalid")
    expect(JSON.parse(unknown.error?.details ?? "{}")).toEqual({ field: "columns", column: "salary" })
    expect((await admissions.rpc("export_leads", { filters: {}, columns: ["status", "status"] })).error?.message).toBe("invalid")
    expect((await admissions.rpc("export_leads", { filters: { status: "Nonsense" }, columns: ["status"] })).error?.message).toBe("invalid")
    expect((await anonClient().rpc("export_leads", { filters: {}, columns: ["status"] })).error?.code).toBe("42501")
    const nobody = await signedIn(await createThrowawayStaff([]))
    expect(await exportStudents(nobody, {}, ["status"])).toEqual({ ok: false, error: { kind: "forbidden" } })
  })

  test("leads.export alone gains leads.view on its role", async () => {
    const exporter = await createThrowawayStaff(["leads.export"])
    const lead = await oneLead()
    const result = await exportStudents(await signedIn(exporter), { query: lead.admissionNumber }, ["admission_number", "guardian_name"])
    expect(result.ok && result.data.rows).toEqual([[lead.admissionNumber, "Mzazi Punguzo"]])
  })
})

describe("which students", () => {
  test("mirrors the Leads screen's search and narrows by import, class and year", async () => {
    const lead = await oneLead()
    const admissions = await signedIn(ADMISSIONS)
    const byNumber = await exportStudents(admissions, { query: lead.admissionNumber.slice(-5), status: "Declined" }, ["admission_number"])
    // A query ignores the status filter, as on the screen.
    expect(byNumber.ok && byNumber.data.rows).toEqual([[lead.admissionNumber]])
    const byName = await exportStudents(admissions, { query: lead.name.toUpperCase() }, ["admission_number"])
    expect(byName.ok && byName.data.rows).toEqual([[lead.admissionNumber]])
    const otherClass = await exportStudents(admissions, { query: lead.name, className: "FORM 4" }, ["admission_number"])
    expect(otherClass.ok && otherClass.data.rows).toEqual([])
    const sameYear = await exportStudents(admissions, { query: lead.name, enrollmentYear: 2027 }, ["admission_number"])
    expect(sameYear.ok && sameYear.data.rowCount).toBe(1)
  })
})
