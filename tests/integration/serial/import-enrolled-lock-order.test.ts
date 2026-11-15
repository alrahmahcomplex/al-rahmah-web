import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead, getLead, type CreateLeadInput } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { checkStudentImportFile, confirmStudentImport } from "@/lib/services/student-import"
import { confirmationOf } from "@/lib/student-import"

import { asSystem, inRolledBackTransaction, signedIn } from "../../support/db"
import { claimFeeYear } from "../../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../../support/fixtures"

// Setting a lead Enrolled against the kill-switch resume (#372), with two
// connections in a fixed interleaving. The resume takes the pause lock
// exclusive and then recomputes every sibling group, so it wants the row of
// every lead it recomputes. The Enrolled trigger wants the pause lock, shared,
// through lock_families. Every real writer takes the lead's Family lock (and
// with it the pause lock) before the lead's row, so it waits holding nothing.
// The resume is global, so this file runs in integration-serial
// (vitest.config.mts): after every other file, and alone.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

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

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

async function family(year: number): Promise<string[]> {
  const admissions = await signedIn(ADMISSIONS)
  const ids: string[] = []
  let guardian: CreateLeadInput["guardian"] = {
    contact: { fullName: `Order Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
  }
  for (let i = 0; i < 2; i++) {
    const created = await createLead(admissions, {
      guardian,
      student: { fullName: `Order ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: yesterday },
    })
    if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
    ids.push(created.data.leadId)
    if (i === 0) {
      const lead = await getLead(admissions, created.data.leadId)
      if (!lead.ok) throw new Error("setup failed")
      guardian = { contactId: lead.data.contact.id }
    }
  }
  for (const id of ids) {
    const registered = await registerForInterview(admissions, id)
    if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
    const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
    if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
    await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  }
  return ids
}

// A backend waiting on the pause lock (pg_advisory_xact_lock(hashtext(...))
// keys a bigint: objsubid 1, the low 32 bits in objid).
async function pauseWaiters(sql: Client): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int as n from pg_locks
     where locktype = 'advisory' and not granted and objsubid = 1
       and objid::bigint = (hashtext('sibling_grants_pause')::bigint & 4294967295)`,
  )
  return rows[0].n
}

async function untilWaiting(sql: Client) {
  for (let tries = 0; (await pauseWaiters(sql)) === 0; tries++) {
    if (tries > 200) throw new Error("nothing waited on the pause lock")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const outcome = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string; message?: string }) => e.code ?? e.message ?? "error")

describe("setting Enrolled while grants resume", () => {
  // Why every writer takes the lead's Family lock (lock_lead_family, or a
  // lead insert's trigger) before the lead's row. The resume holds the pause
  // lock exclusive and then wants the row of every lead it recomputes; the
  // Enrolled trigger wants the pause lock, shared, through lock_families. A
  // writer that took the row first closes the cycle and Postgres aborts one
  // of the two (40P01). One that took the Family lock first waits holding
  // nothing, and both finish.
  test.each([
    ["takes the row first", false, ["40P01", "ok"]],
    ["takes the Family lock first", true, ["ok", "ok"]],
  ])("a writer that %s", async (_, lockFirst, expected) => {
    const [first, imported] = await family(await yearWithSchedule())
    const paid = await recordPayment(await signedIn(ACCOUNTANT), first, { type: "full_payment", amount: 2_000_000, paidOn: today }, randomUUID())
    if (!paid.ok) throw new Error("payment failed")

    const outcomes = await inRolledBackTransaction(async (resume) => {
      await resume.query("select public.set_audit_actor('system')")
      // The resume's first step, the pause lock exclusive, held from here.
      await resume.query("select public.set_sibling_grants_paused(true)")
      const enrolling = outcome(
        inRolledBackTransaction(async (sql) => {
          await sql.query("select public.set_audit_actor('system')")
          if (lockFirst) await sql.query("select public.lock_lead_family($1)", [imported])
          await sql.query("select public.set_lead_lifecycle_override('import')")
          await sql.query("update public.leads set status = 'Enrolled', enrolled_by_import = true where id = $1", [imported])
        }),
      )
      await untilWaiting(resume)
      // The resume recomputes the group, which holds the waiting lead.
      const resumed = await outcome(resume.query("select public.set_sibling_grants_paused(false)"))
      await resume.query("rollback")
      await resume.query("begin")
      return [resumed, await enrolling]
    })
    expect(outcomes.sort()).toEqual(expected)
  }, 60_000)

  // A smoke test of the real path. The import can't close the cycle above
  // because every lead it sets Enrolled is one it inserted in its own
  // transaction: the resume can't see that row, so it never waits on it. Here
  // the import waits on the pause lock, and both finish. The family below has
  // nothing to do with the imported lead (a new contact and phone); it only
  // gives the resume a group to recompute. The import runs through PostgREST,
  // whose statement timeout (8 s for authenticated) covers the whole resume.
  test("the real student import, against the kill-switch resume", async () => {
    const [first] = await family(await yearWithSchedule())
    const paid = await recordPayment(await signedIn(ACCOUNTANT), first, { type: "full_payment", amount: 2_000_000, paidOn: today }, randomUUID())
    if (!paid.ok) throw new Error("payment failed")

    const s = randomUUID().slice(0, 6)
    const header = "Student name,Class,Enrollment year,Day or boarding,Parent/guardian name,Relationship,Parent phone,WhatsApp,Visit date,Discount code,Status"
    const file = `${header}\r\nOrder Import ${s},STD 2,${thisYear + 1},Day,Mama Order ${s},Mother,09${randomInt(10_000_000, 100_000_000)},,2026-09-01,,Enrolled\r\n`
    const manager = await signedIn(MANAGER)
    const checked = await checkStudentImportFile(manager, "order.csv", new TextEncoder().encode(file))
    if (!checked.ok) throw new Error(JSON.stringify(checked.error))

    const result = await inRolledBackTransaction(async (resume) => {
      await resume.query("select public.set_audit_actor('system')")
      await resume.query("select public.set_sibling_grants_paused(true)")
      const importing = outcome(
        confirmStudentImport(manager, confirmationOf(checked.data)).then((r) => {
          if (!r.ok) throw new Error(JSON.stringify(r.error))
        }),
      )
      await untilWaiting(resume)
      const resumed = await outcome(resume.query("select public.set_sibling_grants_paused(false)"))
      await resume.query("rollback")
      await resume.query("begin")
      return { resumed, importing: await importing }
    })
    expect(result).toEqual({ resumed: "ok", importing: "ok" })
  }, 60_000)

  test("a creation waits on the pause lock, not the Family lock, while a resume is queued", async () => {
    const [known] = await family(await yearWithSchedule())
    const lead = await getLead(await signedIn(ADMISSIONS), known)
    if (!lead.ok) throw new Error("setup failed")
    const contactId = lead.data.contact.id

    const seen = await inRolledBackTransaction(async (holder) => {
      // As the flaky test: hold the Family lock (and so the pause lock, shared).
      await holder.query("select public.lock_families(array[$1::uuid])", [contactId])
      // Another suite's resume asks for the pause lock exclusive and queues.
      const resuming = outcome(
        inRolledBackTransaction(async (resume) => {
          await resume.query("select pg_advisory_xact_lock(hashtext('sibling_grants_pause'))")
        }),
      )
      await untilWaiting(holder)
      const creating = outcome(
        createLead(await signedIn(ADMISSIONS), {
          guardian: { contactId },
          student: { fullName: `Order ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
          start: { kind: "walk-in", visitDate: yesterday },
        }),
      )
      for (let tries = 0; (await pauseWaiters(holder)) < 2; tries++) {
        if (tries > 200) throw new Error("the creation never queued on the pause lock")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const { rows } = await holder.query<{ n: number }>(
        `select count(*)::int as n from pg_locks
         where locktype = 'advisory' and not granted and classid::int = hashtext('lead_family') and objid::int = hashtext($1)`,
        [contactId],
      )
      // Queued there, it holds nothing it takes later: not the phone lock,
      // not the contact's row.
      const untaken = await inRolledBackTransaction(async (other) => {
        const phoneFree = (
          await other.query<{ got: boolean }>(
            "select pg_try_advisory_xact_lock(hashtextextended('lead-phone:' || public.normalize_phone($1), 0)) as got",
            [lead.data.contact.phone],
          )
        ).rows[0].got
        const rowFree = (await other.query("select id from public.guardian_contacts where id = $1 for update skip locked", [contactId]))
          .rowCount
        return phoneFree && rowFree === 1
      })
      await holder.query("rollback")
      await holder.query("begin")
      return { familyWaiters: rows[0].n, untaken, resuming: await resuming, creating: await creating }
    })
    expect(seen).toEqual({ familyWaiters: 0, untaken: true, resuming: "ok", creating: "ok" })
  }, 60_000)
})
