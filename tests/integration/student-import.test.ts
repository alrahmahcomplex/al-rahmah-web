import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { adjustPayment } from "@/lib/services/payment-adjustments"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { checkStudentImportFile, confirmStudentImport, getLeadImportMark, getStudentImport } from "@/lib/services/student-import"
import { confirmationOf, studentImportSummary, tanzaniaToday } from "@/lib/student-import"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn, unusedAdmissionNumber } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The student import (owner decisions of 2026-11-09), through the module
// against local Supabase. Every name is invented and every number is
// 09xx xxx xxx, clear of the other test files' numbers.

const today = tanzaniaToday()
const nextYear = Number(today.slice(0, 4)) + 1
const HEADER = "Student name,Class,Enrollment year,Day or boarding,Parent/guardian name,Relationship,Parent phone,WhatsApp,Visit date,Discount code,Status"

function importPhone(): { typed: string; stored: string } {
  const digits = String(randomInt(10_000_000, 100_000_000))
  return { typed: `09${digits}`, stored: `+2559${digits}` }
}

const bytes = (text: string) => new TextEncoder().encode(text)

// A lead already on file, on a contact of its own with `phone`.
async function existingLead(name: string, phone: string): Promise<{ leadId: string; contactId: string }> {
  const admissionNumber = await unusedAdmissionNumber()
  return asSystem(async (sql) => {
    const contact = await sql.query<{ id: string }>(
      "insert into public.guardian_contacts (full_name, relationship, phone, origin) values ('Mzazi Aliyepo', 'Father', $1, 'front_desk') returning id",
      [phone],
    )
    const lead = await sql.query<{ id: string }>(
      `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, visit_date, guardian_contact_id)
       values ($1, $2, 'STD 3', $3, 'Day', 'Visited', '2026-09-01', $4) returning id`,
      [admissionNumber, name, nextYear, contact.rows[0].id],
    )
    return { leadId: lead.rows[0].id, contactId: contact.rows[0].id }
  })
}

type LeadRow = {
  id: string
  student_name: string
  class_name: string
  status: string
  visit_date: string | null
  day_or_boarding: string
  referral_code: string | null
  import_batch_id: string | null
  enrolled_by_import: boolean
  imported_as_enrolled: boolean
  declined_reason: string | null
  declined_explanation: string | null
  status_before_decline: string | null
  returning_family_joined: boolean
  guardian_contact_id: string
  relationship: string
  relationship_description: string | null
  pending_family_match_id: string | null
  origin: string
  pre_form_one: boolean | null
  interviews: { fee_status: string; result: string | null; import_batch_id: string | null }[]
}

async function leadsOfBatch(batchId: string): Promise<Map<string, LeadRow>> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<LeadRow>(
      `select l.id, l.student_name, l.class_name::text, l.status::text, to_char(l.visit_date, 'YYYY-MM-DD') as visit_date,
              l.day_or_boarding::text, l.referral_code, l.import_batch_id, l.enrolled_by_import, l.imported_as_enrolled,
              l.declined_reason::text, l.declined_explanation, l.status_before_decline::text, l.returning_family_joined,
              l.guardian_contact_id, g.relationship::text, g.relationship_description, g.pending_family_match_id, g.origin::text,
              p.pre_form_one,
              coalesce((select jsonb_agg(jsonb_build_object('fee_status', i.fee_status, 'result', i.result, 'import_batch_id', i.import_batch_id))
                        from public.interviews i where i.lead = l.id), '[]') as interviews
       from public.leads l
       join public.guardian_contacts g on g.id = l.guardian_contact_id
       left join public.lead_fee_profiles p on p.lead_id = l.id
       where l.import_batch_id = $1`,
      [batchId],
    )
    return new Map(rows.map((row) => [row.student_name.replace(/ \w+$/, ""), row]))
  })
}

describe("who may import students", () => {
  test("staff without leads.import are refused the check and the confirm, and so is a signed-out visitor", async () => {
    const row = {
      sheet_row: 2,
      student_name: "Nobody",
      class_name: "STD 1",
      pre_form_one: false,
      enrollment_year: nextYear,
      day_or_boarding: "Day",
      guardian_name: "Nobody",
      relationship: "Mother",
      relationship_description: null,
      phone: importPhone().stored,
      whatsapp: null,
      visit_date: null,
      referral_code: null,
      status: "Applied",
    }
    for (const client of [await signedIn(ADMISSIONS), await signedIn(await createThrowawayStaff(["leads.view", "leads.create"]))]) {
      expect((await client.rpc("check_student_import", { rows: [row] })).error?.message).toBe("not_permitted")
      expect((await client.rpc("confirm_student_import", { file_name: "x.csv", row_count: 1, rows: [row] })).error?.message).toBe(
        "not_permitted",
      )
    }
    expect((await anonClient().rpc("check_student_import", { rows: [row] })).error?.code).toBe("42501")
    expect((await anonClient().rpc("confirm_student_import", { file_name: "x.csv", row_count: 1, rows: [row] })).error?.code).toBe("42501")
    const file = `${HEADER}\r\nNobody,STD 1,${nextYear},,Nobody,Mother,${row.phone},,,,\r\n`
    expect(await checkStudentImportFile(await signedIn(ADMISSIONS), "x.csv", bytes(file))).toEqual({ ok: false, error: { kind: "forbidden" } })
  })
})

describe("importing a workbook", () => {
  test("creates, joins a family, skips the students on file, and marks every lead with its batch", async () => {
    const s = randomUUID().slice(0, 6)
    const [a, b, c, d, e, g] = [importPhone(), importPhone(), importPhone(), importPhone(), importPhone(), importPhone()]
    const family = importPhone()
    const known = await existingLead(`Existing Child ${s}`, family.stored)
    const file = [
      HEADER,
      `Applied Kid ${s},STD 1,${nextYear},,Mama A ${s},Mother,${a.typed},,,,`,
      `Visited Kid ${s},KG 2,${nextYear},Boarding,Baba B ${s},Father,${b.typed},,05/09/2026,,`,
      `Interviewed Kid ${s},PRE-FORM ONE,${nextYear},Day,Shangazi C ${s},Aunt,${c.typed},,2026-09-06,,Interviewed`,
      `Contracted Kid ${s},STD 4,${nextYear},Day,Mama D ${s},,${d.typed},,6-Sep-26,,Contracted`,
      `Declined Kid ${s},STD 2,${nextYear},Day,Mama E ${s},Mother,${e.typed},,,,Declined`,
      `Sibling Kid ${s},STD 2,${nextYear},Day,Mama A ${s},Mother,${a.typed},,,,`,
      `New Sibling ${s},STD 3,${nextYear},Day,Mzazi F ${s},Guardian,${family.typed},,,,`,
      `Existing Child ${s},STD 3,${nextYear},Day,Mzazi F ${s},Guardian,${family.typed},,,,`,
      `Code Kid ${s},STD 5,${nextYear},Day,Mama G ${s},Mother,${g.typed},,,NOBODY${s.toUpperCase()},`,
      `Bad Class Kid ${s},GRADE 9,${nextYear},Day,Mama H ${s},Mother,${importPhone().typed},,,,`,
    ].join("\r\n")
    const manager = await signedIn(MANAGER)
    const fileName = `workbook-${s}.csv`

    const checked = await checkStudentImportFile(manager, fileName, bytes(file))
    if (!checked.ok) throw new Error(JSON.stringify(checked.error))
    const byName = new Map(checked.data.rows.map((row) => [row.normalized.studentName?.replace(/ \w+$/, ""), row]))
    expect(studentImportSummary(checked.data.rows)).toMatchObject({ create: 7, "joins-family": 1, present: 1, refused: 1, flagged: 0, skipped: 2 })
    expect(byName.get("Sibling Kid")?.verdict).toMatchObject({ verdict: "create", familyRow: 2 })
    expect(byName.get("New Sibling")?.verdict).toMatchObject({ verdict: "joins_family", family: { contactId: known.contactId } })
    expect(byName.get("Existing Child")?.verdict).toMatchObject({ verdict: "present", lead: { id: known.leadId } })
    expect(byName.get("Code Kid")?.verdict).toMatchObject({ verdict: "create", unknownCode: true })
    expect(byName.get("Bad Class Kid")).toMatchObject({ class: "refused", reason: "Unknown class", verdict: null })

    const confirmed = await confirmStudentImport(manager, confirmationOf(checked.data))
    if (!confirmed.ok || confirmed.data.kind !== "imported") throw new Error(JSON.stringify(confirmed))
    expect(confirmed.data).toMatchObject({ created: 7, joinedFamily: 1, skipped: 2 })
    const batchId = confirmed.data.batchId

    const leads = await leadsOfBatch(batchId)
    expect(leads.size).toBe(8)
    expect(leads.get("Applied Kid")).toMatchObject({ status: "Applied", visit_date: null, class_name: "STD 1", day_or_boarding: "Day", origin: "front_desk" })
    expect(leads.get("Visited Kid")).toMatchObject({ status: "Visited", visit_date: "2026-09-05", day_or_boarding: "Boarding", relationship: "Father" })
    expect(leads.get("Interviewed Kid")).toMatchObject({
      status: "Interviewed",
      class_name: "FORM 1",
      pre_form_one: true,
      relationship: "Other",
      relationship_description: "Aunt",
      interviews: [{ fee_status: "Not Paid", result: null, import_batch_id: batchId }],
    })
    expect(leads.get("Contracted Kid")).toMatchObject({
      status: "Enrolled",
      enrolled_by_import: true,
      imported_as_enrolled: true,
      visit_date: "2026-09-06",
      relationship: "Other",
      relationship_description: "Parent/guardian",
      interviews: [{ fee_status: "Not Paid", result: null, import_batch_id: batchId }],
    })
    expect(leads.get("Declined Kid")).toMatchObject({
      status: "Declined",
      declined_reason: "Other",
      declined_explanation: "Imported from the workbook",
      status_before_decline: "Applied",
      interviews: [],
    })
    expect(leads.get("Sibling Kid")?.guardian_contact_id).toBe(leads.get("Applied Kid")?.guardian_contact_id)
    expect(leads.get("New Sibling")).toMatchObject({ pending_family_match_id: known.contactId, returning_family_joined: true })
    expect(leads.get("Code Kid")?.referral_code).toBe(`NOBODY${s.toUpperCase()}`)

    // The batch, for the Done step and each lead's history line.
    expect(await getStudentImport(await signedIn(ADMISSIONS), batchId)).toEqual({
      ok: true,
      data: expect.objectContaining({ fileName, importedBy: MANAGER.name, rowCount: 10, createdCount: 8, skippedCount: 2 }),
    })
    expect(await getLeadImportMark(await signedIn(ADMISSIONS), leads.get("Contracted Kid")!.id)).toEqual({
      ok: true,
      data: { batch: expect.objectContaining({ id: batchId }), enrolledByImport: true },
    })

    // The same file again: every student is on file now.
    const again = await checkStudentImportFile(manager, fileName, bytes(file))
    if (!again.ok) throw new Error(JSON.stringify(again.error))
    expect(studentImportSummary(again.data.rows)).toMatchObject({ create: 0, "joins-family": 0, present: 9, refused: 1 })
    expect(await confirmStudentImport(manager, confirmationOf(again.data))).toEqual({ ok: false, error: { kind: "nothing-to-import" } })
  })

  test("writes nothing when a verdict changed since the check", async () => {
    const s = randomUUID().slice(0, 6)
    const phone = importPhone()
    const file = `${HEADER}\r\nLate Kid ${s},STD 1,${nextYear},,Mama Late ${s},Mother,${phone.typed},,,,\r\n`
    const manager = await signedIn(MANAGER)
    const checked = await checkStudentImportFile(manager, "late.csv", bytes(file))
    if (!checked.ok) throw new Error(JSON.stringify(checked.error))
    // Someone puts the same child on file before the confirm.
    await existingLead(`Late Kid ${s}`, phone.stored)
    const confirmed = await confirmStudentImport(manager, confirmationOf(checked.data))
    expect(confirmed).toEqual({
      ok: true,
      data: { kind: "changed", changed: [{ sheetRow: 2, verdict: expect.objectContaining({ verdict: "present" }) }] },
    })
    const count = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ n: number }>("select count(*)::int as n from public.import_batches where file_name = 'late.csv' and kind = 'students'")
      return rows[0].n
    })
    expect(count).toBe(0)
  })

  test("the database re-checks every value it is sent", async () => {
    const manager = await signedIn(MANAGER)
    const row = {
      sheet_row: 2,
      student_name: "Sent  Twice ",
      class_name: "STD 9",
      pre_form_one: false,
      enrollment_year: nextYear,
      day_or_boarding: "Day",
      guardian_name: "Mama",
      relationship: "Mother",
      relationship_description: null,
      phone: "0712",
      whatsapp: null,
      visit_date: null,
      referral_code: null,
      status: "Applied",
    }
    const { data } = await manager.rpc("check_student_import", { rows: [row] })
    expect(data).toEqual([{ sheet_row: 2, verdict: { verdict: "refused", field: "student_name" } }])
    const { data: second } = await manager.rpc("check_student_import", { rows: [{ ...row, student_name: "Sent Twice" }] })
    expect(second).toEqual([{ sheet_row: 2, verdict: { verdict: "refused", field: "class_name" } }])
    const twice = await manager.rpc("check_student_import", {
      rows: [
        { ...row, student_name: "Sent Twice", class_name: "STD 1", phone: "+255900000001" },
        { ...row, sheet_row: 3, student_name: "sent twice", class_name: "STD 1", phone: "+255900000001" },
      ],
    })
    expect(twice.error?.message).toBe("invalid")
  })
})

describe("an import's Enrolled", () => {
  // STD 2 Day: TZS 2,000,000; First instalment from 800,000; Deposit from 300,000.
  const AMOUNTS: FeeAmounts = {
    bands: {
      nursery: { day: 1_100_000, boarding: 3_000_000 },
      primary_lower: { day: 2_000_000, boarding: 3_000_000 },
      primary_upper: { day: 2_100_000, boarding: 3_300_000 },
      secondary: { day: 2_800_000, boarding: 4_300_000 },
    },
    split: { first: 40, second: 40, third: 20 },
    dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
    minimumDeposit: 300_000,
    preFormOne: { day: 450_000, boarding: 580_000 },
  }

  test("stays Enrolled with no qualifying payment, and follows the payments once one qualifies", async () => {
    const claim = await claimFeeYear()
    onTestFinished(claim.release)
    const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
    if (!saved.ok) throw new Error(JSON.stringify(saved.error))
    await asSystem((sql) => sql.query("update public.fee_schedules set academic_year_start = null where enrollment_year = $1", [claim.year]))

    const s = randomUUID().slice(0, 6)
    const file = `${HEADER}\r\nPaying Kid ${s},STD 2,${nextYear},Day,Mama Pay ${s},Mother,${importPhone().typed},,2026-09-01,,Contracted\r\n`
    const manager = await signedIn(MANAGER)
    const checked = await checkStudentImportFile(manager, "paying.csv", bytes(file))
    if (!checked.ok) throw new Error(JSON.stringify(checked.error))
    const confirmed = await confirmStudentImport(manager, confirmationOf(checked.data))
    if (!confirmed.ok || confirmed.data.kind !== "imported") throw new Error(JSON.stringify(confirmed))
    const [lead] = [...(await leadsOfBatch(confirmed.data.batchId)).values()]

    // Moving the lead to the claimed year recomputes it, with no payment yet.
    await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [lead.id, claim.year]))
    const state = async () =>
      inRolledBackTransaction(async (sql) => {
        const { rows } = await sql.query<{ status: string; enrolled_by_import: boolean }>(
          "select status::text, enrolled_by_import from public.leads where id = $1",
          [lead.id],
        )
        return rows[0]
      })
    expect(await state()).toEqual({ status: "Enrolled", enrolled_by_import: true })

    // A deposit doesn't qualify: still the import's Enrolled. The payment is
    // allowed though the imported interview has no result.
    const accountant = await signedIn(ACCOUNTANT)
    const deposit = await recordPayment(accountant, lead.id, { type: "initial_deposit", amount: 300_000, paidOn: today }, randomUUID())
    expect(deposit.ok).toBe(true)
    expect(await state()).toEqual({ status: "Enrolled", enrolled_by_import: true })

    // The rest of the fee qualifies: the mark clears, still Enrolled.
    const rest = await recordPayment(accountant, lead.id, { type: "first_instalment", amount: 1_700_000, paidOn: today }, randomUUID())
    if (!rest.ok) throw new Error(rest.error)
    expect(await state()).toEqual({ status: "Enrolled", enrolled_by_import: false })

    // From now on Enrolled is the payments': voiding the payment that
    // qualified takes it away.
    const voided = await adjustPayment(accountant, rest.data.paymentId, { reason: "Duplicate entry", void: true, note: null }, randomUUID())
    expect(voided.ok).toBe(true)
    expect(await state()).toEqual({ status: "Interviewed", enrolled_by_import: false })
  })

  test("the workbook pass on payments ends once the imported interview has a result", async () => {
    const claim = await claimFeeYear()
    onTestFinished(claim.release)
    const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
    if (!saved.ok) throw new Error(JSON.stringify(saved.error))

    const s = randomUUID().slice(0, 6)
    const file = `${HEADER}\r\nFailed Kid ${s},STD 2,${nextYear},Day,Mama Fail ${s},Mother,${importPhone().typed},,2026-09-01,,Contracted\r\n`
    const manager = await signedIn(MANAGER)
    const checked = await checkStudentImportFile(manager, "failed.csv", bytes(file))
    if (!checked.ok) throw new Error(JSON.stringify(checked.error))
    const confirmed = await confirmStudentImport(manager, confirmationOf(checked.data))
    if (!confirmed.ok || confirmed.data.kind !== "imported") throw new Error(JSON.stringify(confirmed))
    const [lead] = [...(await leadsOfBatch(confirmed.data.batchId)).values()]
    await asSystem(async (sql) => {
      await sql.query("update public.leads set enrollment_year = $2 where id = $1", [lead.id, claim.year])
      // Staff record a Failed result on the imported interview.
      await sql.query(
        "update public.interviews set result = 'Failed', score = 31, interview_date = $2 where lead = $1",
        [lead.id, today],
      )
    })

    const paid = await recordPayment(await signedIn(ACCOUNTANT), lead.id, { type: "initial_deposit", amount: 300_000, paidOn: today }, randomUUID())
    expect(paid).toEqual({ ok: false, error: "not_passed" })
  })

  test("only the import sets the mark, and a lead's batch never changes", async () => {
    const lead = await existingLead(`Marked Kid ${randomUUID().slice(0, 6)}`, importPhone().stored)
    const outcome = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const attempt = async (query: string) => {
        await sql.query("savepoint s")
        const answer = await sql.query(query, [lead.leadId]).then(() => "done", (error: Error) => error.message)
        await sql.query("rollback to savepoint s")
        return answer
      }
      return {
        mark: await attempt("update public.leads set enrolled_by_import = true where id = $1"),
        imported: await attempt("update public.leads set imported_as_enrolled = true where id = $1"),
        batch: await (async () => {
          await sql.query(
            `insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
             values ('students', 'other.csv', $1, 1, 1, 0, 0)`,
            [MANAGER.id],
          )
          return attempt("update public.leads set import_batch_id = (select id from public.import_batches where file_name = 'other.csv' order by imported_at desc limit 1) where id = $1")
        })(),
      }
    })
    expect(outcome).toEqual({ mark: "enrolled_by_import_locked", imported: "lead_import_locked", batch: "lead_import_locked" })
  })
})
