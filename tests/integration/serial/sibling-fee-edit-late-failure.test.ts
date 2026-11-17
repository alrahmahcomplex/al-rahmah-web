import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test, vi } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, type LeadClass, type NewContact } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { editSiblingFee, linkSibling, previewSiblingFeeEdit } from "@/lib/services/sibling-groups"
import { decideSiblingRequest, requestSiblingDiscount } from "@/lib/services/sibling-requests"

import { asSystem, inOneSnapshot, signedIn } from "../../support/db"
import { claimFeeYear } from "../../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../../support/fixtures"

// A Sibling fee edit that fails after its fee writes (#369). edit_sibling_fee
// writes the lead's Sibling result, recomputes the lead's and its group's
// fees, inserts the sibling_fee_edits row (and its audit row), and then closes
// "Granted: fee edit needed". A failure at either of the last two steps must
// undo the fee writes before it. Today Postgres does that, since the function
// runs in one transaction; these tests notice a change that catches the error
// after the fee writes or moves part of the work out of the transaction.
//
// The failure is a trigger that raises for one lead only. The service saves
// through the API on a connection of its own, so the trigger must be
// committed for it to fire there, and creating a trigger locks its table
// against writes. So the tests live here, in the integration-serial project,
// which runs after every other integration file has finished and one file at
// a time (vitest.config.ts). Each test drops its trigger when it finishes.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// Day fees: STD 2 2,000,000; FORM 1 2,800,000.
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

const STD2 = 2_000_000
const FORM1 = 2_800_000

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function parent(): NewContact {
  // A leading 06 keeps it clear of the seeded numbers and the other sibling suites.
  return {
    fullName: `Late Failure Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  }
}

// A father's name of two words no other test uses.
function father(): string {
  const word = () => randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "a")
  return `F${word()} H${word()}`
}

async function pass(leadId: string, year: number) {
  const admissions = await signedIn(ADMISSIONS)
  const registered = await registerForInterview(admissions, leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result: "Passed",
    score: 80,
  })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
}

// A Passed child in `year` on a new contact, named for `fatherName`.
async function child(year: number, fatherName: string, className: LeadClass): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: parent() },
    student: { fullName: `Kid${randomUUID().slice(0, 6)} ${fatherName}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  await pass(created.data.leadId, year)
  return created.data.leadId
}

async function payInFull(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "full_payment", amount: fee.data.schoolFee, paidOn: today },
    randomUUID(),
  )
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
}

// A lead marked "Granted: fee edit needed": Enrolled at Full fee, then linked
// to a child of another father and granted the Sibling discount on request.
// The other child, not yet Enrolled, has the 10% while the Enrolled lead
// pays full, so a 10% on the Enrolled lead moves the other child's fee too.
async function feeEditNeeded(year: number): Promise<{ enrolled: string; other: string }> {
  const enrolled = await child(year, father(), "STD 2")
  await payInFull(enrolled)
  const other = await child(year, father(), "FORM 1")
  const linked = await linkSibling(await signedIn(ADMISSIONS), { leadId: enrolled, siblingOfLeadId: other })
  expect(linked).toMatchObject({ ok: true, data: { kind: "linked", basis: "request_needed" } })
  const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), {
    leadId: enrolled,
    note: "Birth certificates show the same mother.",
    requestId: randomUUID(),
  })
  if (!asked.ok) throw new Error(`request failed: ${JSON.stringify(asked.error)}`)
  const granted = await decideSiblingRequest(await signedIn(MANAGER), asked.data, { decision: "grant" })
  if (!granted.ok) throw new Error(`grant failed: ${JSON.stringify(granted.error)}`)
  return { enrolled, other }
}

// Makes the save fail at `step` for `leadId` alone, until the test finishes.
// `edit row`: the insert into sibling_fee_edits, after the fee writes.
// `flag close`: closing "Granted: fee edit needed", after the edit row and its audit row.
async function failAt(step: "edit row" | "flag close", leadId: string): Promise<{ drop: () => Promise<void> }> {
  const name = `test_369_late_failure_${randomUUID().replace(/-/g, "")}`
  const on =
    step === "edit row"
      ? `before insert on public.sibling_fee_edits for each row when (new.lead_id = '${leadId}'::uuid)`
      : `before update on public.discount_requests for each row
         when (new.lead_id = '${leadId}'::uuid and old.fee_edit = 'needed' and new.fee_edit is distinct from 'needed')`
  await asSystem(async (sql) => {
    await sql.query(`create function public.${name}() returns trigger language plpgsql as $fn$
      begin
        raise exception 'test_369_late_failure';
      end;
      $fn$`)
    await sql.query(`create trigger ${name} ${on} execute function public.${name}()`)
  })
  let dropped = false
  const drop = async () => {
    if (dropped) return
    dropped = true
    await asSystem((sql) => sql.query(`drop function public.${name}() cascade`))
  }
  onTestFinished(drop)
  return { drop }
}

// Everything the save writes, read in one snapshot: every fee in the database
// with its status and Seat priority, the Sibling result and group of each
// lead the edit reaches, the lead's edit rows, every audit row for those
// leads, and "Granted: fee edit needed".
async function state(leadIds: string[]) {
  return inOneSnapshot(async (sql: Client) => {
    const rows = async (query: string) => (await sql.query(query, [leadIds])).rows
    return {
      fees: Object.fromEntries(
        (await sql.query<{ item: string; value: unknown }>("select item, value from public.fee_snapshot() order by item")).rows.map((r) => [
          r.item,
          r.value,
        ]),
      ),
      results: await rows("select to_jsonb(r) as row from public.lead_sibling_results r where r.lead_id = any($1) order by r.lead_id"),
      groups: await rows(
        `select to_jsonb(g) as row from public.sibling_groups g
         where g.id in (select m.group_id from public.sibling_group_members m where m.lead_id = any($1))
         order by g.id`,
      ),
      members: await rows("select to_jsonb(m) as row from public.sibling_group_members m where m.lead_id = any($1) order by m.lead_id"),
      edits: await rows("select to_jsonb(e) as row from public.sibling_fee_edits e where e.lead_id = any($1)"),
      audit: await rows("select a.id, a.table_name, a.action from public.audit_log a where a.lead_id = any($1) order by a.id"),
      requests: await rows(
        `select r.lead_id, r.state, r.fee_edit, r.fee_edit_closed_by, r.fee_edit_closed_at, r.fee_edit_reason
         from public.discount_requests r where r.lead_id = any($1) and r.kind = 'sibling' order by r.lead_id`,
      ),
    }
  })
}

describe("a Sibling fee edit that fails after its fee writes (#369)", () => {
  test.each(["edit row", "flag close"] as const)(
    "a 10% whose save fails at the %s returns an error and leaves every fee, result, edit, audit row and flag as before",
    async (step) => {
      const year = await yearWithSchedule()
      const { enrolled, other } = await feeEditNeeded(year)
      const accountant = await signedIn(ACCOUNTANT)
      const input = { leadId: enrolled, value: "ten", reason: "sibling_proof_after_enrolment" } as const

      // The 10% would move both fees: the Enrolled lead's down, and the
      // other child's up, since it becomes the full payer.
      const previewed = await previewSiblingFeeEdit(accountant, enrolled, "ten")
      if (!previewed.ok) throw new Error(`preview failed: ${JSON.stringify(previewed.error)}`)
      expect(previewed.data.changes.map((c) => [c.leadId, c.schoolFeeChange])).toEqual(
        expect.arrayContaining([
          [enrolled, -STD2 / 10],
          [other, FORM1 / 10],
        ]),
      )

      const before = await state([enrolled, other])
      expect(before.requests).toMatchObject([{ lead_id: enrolled, state: "granted", fee_edit: "needed" }])
      expect(before.edits).toEqual([])
      expect(before.fees[`lead:${enrolled}`]).toMatchObject({ status: "Enrolled", school_fee: STD2 })

      const failure = await failAt(step, enrolled)
      const requestId = randomUUID()
      const logged = vi.spyOn(console, "error").mockImplementation(() => {})
      try {
        expect(await editSiblingFee(accountant, input, requestId)).toEqual({ ok: false, error: { kind: "unavailable" } })
        // The service logs what it could not map, the trigger's own error.
        expect(JSON.stringify(logged.mock.calls)).toContain("test_369_late_failure")
      } finally {
        logged.mockRestore()
      }

      expect(await state([enrolled, other])).toEqual(before)

      // With the trigger gone the same request saves: the failure used up
      // nothing, and the fee writes it undid were real ones.
      await failure.drop()
      const saved = await editSiblingFee(accountant, input, requestId)
      if (!saved.ok) throw new Error(`edit failed: ${JSON.stringify(saved.error)}`)
      expect(saved.data.changes).toEqual(previewed.data.changes)
      const after = await state([enrolled, other])
      expect(after.fees[`lead:${enrolled}`]).toMatchObject({ school_fee: STD2 - STD2 / 10 })
      expect(after.fees[`lead:${other}`]).toMatchObject({ school_fee: FORM1 })
      expect(after.edits).toHaveLength(1)
      expect(after.requests).toMatchObject([{ lead_id: enrolled, fee_edit: "applied", fee_edit_reason: "sibling_proof_after_enrolment" }])
    },
  )
})
