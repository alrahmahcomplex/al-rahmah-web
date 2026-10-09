import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead, type LeadClass } from "@/lib/services/leads"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"

import { asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Enrolling First instalment leads on the Academic-year start (#109), against
// local Supabase. No test waits for a date: each gives the enrolment a date
// of its own, inside a transaction that is rolled back. Rolling back matters
// beyond tidiness: the enrolment sweeps every year whose start has passed by
// that date, the seeded 2027 and other tests' years included, so nothing it
// does may outlive the test.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// STD 2 Day: TZS 2,000,000, so First instalment from 800,000 and Deposit
// from 300,000.
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

// A claimed year with a schedule and an Academic-year start on 10 January,
// still to come, so nothing outside the rolled-back transactions enrols its
// First instalment leads.
async function yearStartingJanuary10(): Promise<{ year: number; start: string }> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  const start = `${claim.year}-01-10`
  await asSystem((sql) =>
    sql.query("update public.fee_schedules set academic_year_start = $2 where enrollment_year = $1", [claim.year, start]),
  )
  return { year: claim.year, start }
}

function phone() {
  // A leading 4 keeps it clear of the seeded 700 000 numbers and of the other
  // test files' 05, 06 and 07 numbers.
  return `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A walk-in lead in `year`, interviewed and Passed today.
async function passedLead(year: number, className: LeadClass = "STD 2"): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Start Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Starter ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result: "Passed",
    score: 80,
  })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  return id
}

async function pay(leadId: string, amount: number, overrides: Partial<PaymentInput> = {}) {
  const recorded = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "initial_deposit", amount, paidOn: today, ...overrides },
    randomUUID(),
  )
  if (!recorded.ok) throw new Error(`payment failed: ${recorded.error}`)
  return recorded.data.paymentId
}

async function statusOf(sql: Client, leadId: string): Promise<string> {
  const { rows } = await sql.query("select status::text from public.leads where id = $1", [leadId])
  return rows[0].status
}

async function profileOf(sql: Client, leadId: string) {
  const { rows } = await sql.query(
    `select enrolled_trigger, enrolled_trigger_payment_id, enrolled_on::text, recompute_cause
     from public.lead_fee_profiles where lead_id = $1`,
    [leadId],
  )
  return rows[0] ?? null
}

// The enrolment as set_academic_year and the daily job call it, each with
// an actor already named; here the system.
async function enrol(sql: Client, asOf: string): Promise<number> {
  await sql.query("select public.set_audit_actor('system')")
  const { rows } = await sql.query("select public.enrol_from_academic_year_start($1) as enrolled", [asOf])
  return rows[0].enrolled
}

// Acts inside `sql`'s transaction as a seeded staff member's signed-in
// session, the way the API would, until `asOwner`.
async function asStaff(sql: Client, staffId: string) {
  const { rows } = await sql.query("select user_id from public.staff_members where id = $1", [staffId])
  await sql.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: rows[0].user_id, role: "authenticated" }),
  ])
  await sql.query("set local role authenticated")
}

async function asOwner(sql: Client) {
  await sql.query("reset role")
  await sql.query("select set_config('request.jwt.claims', '', true)")
}

// A past year, with a schedule made only inside `sql`'s transaction and the
// start given (or none), and `leadIds` moved into it. A start in a past
// January has passed, as it has for a school year under way.
async function pastYear(sql: Client, start: "none" | "january-11", leadIds: string[]): Promise<number> {
  const { rows } = await sql.query(
    `select y from generate_series(2000, $1::int) y
     where not exists (select 1 from public.fee_schedules s where s.enrollment_year = y)
     order by random() limit 1`,
    [thisYear - 1],
  )
  if (rows.length === 0) throw new Error("no free past year")
  const year: number = rows[0].y
  await sql.query("select public.set_audit_actor('system')")
  await sql.query(
    `insert into public.fee_schedules (enrollment_year, first_due, second_due, third_due, minimum_deposit,
       pre_form_one_day_fee, pre_form_one_boarding_fee, academic_year_start)
     values ($1, $2, $3, $4, 300000, 450000, 580000, $5)`,
    [year, `${year - 1}-11-01`, `${year}-04-01`, `${year}-06-01`, start === "none" ? null : `${year}-01-11`],
  )
  await sql.query(
    `insert into public.fee_band_amounts (enrollment_year, band, day_fee, boarding_fee) values
       ($1, 'nursery', 1100000, 3000000), ($1, 'primary_lower', 2000000, 3000000),
       ($1, 'primary_upper', 2100000, 3300000), ($1, 'secondary', 2800000, 4300000)`,
    [year],
  )
  await sql.query("update public.leads set enrollment_year = $1 where id = any($2)", [year, leadIds])
  return year
}

async function recordAsAccountant(sql: Client, leadId: string, type: string, amount: number, paidOn: string) {
  await asStaff(sql, ACCOUNTANT.id)
  const { rows } = await sql.query("select public.record_school_fee_payment($1, $2, $3, $4, $5) as recorded", [
    leadId,
    type,
    amount,
    paidOn,
    randomUUID(),
  ])
  await asOwner(sql)
  return rows[0].recorded.payment_id as string
}

describe("enrol_from_academic_year_start", () => {
  test("before the start it leaves a First instalment lead alone; on the start it enrols it, dated the start", async () => {
    const { year, start } = await yearStartingJanuary10()
    const first = await passedLead(year)
    await pay(first, 800_000, { type: "first_instalment" })

    await inRolledBackTransaction(async (sql) => {
      await enrol(sql, `${year}-01-09`)
      expect(await statusOf(sql, first)).toBe("Interviewed")
      expect(await profileOf(sql, first)).toBeNull()

      expect(await enrol(sql, start)).toBeGreaterThanOrEqual(1)
      expect(await statusOf(sql, first)).toBe("Enrolled")
      expect(await profileOf(sql, first)).toEqual({
        enrolled_trigger: "academic_year_start",
        enrolled_trigger_payment_id: null,
        enrolled_on: start,
        recompute_cause: "academic_year_start",
      })
    })
  })

  test("after the start it enrols a lead it missed, still dated the start, and leaves Deposit leads alone", async () => {
    const { year, start } = await yearStartingJanuary10()
    const first = await passedLead(year)
    await pay(first, 1_999_999, { type: "first_instalment" })
    const deposit = await passedLead(year)
    await pay(deposit, 799_999)

    await inRolledBackTransaction(async (sql) => {
      expect(await enrol(sql, `${year}-02-01`)).toBeGreaterThanOrEqual(1)
      expect(await statusOf(sql, first)).toBe("Enrolled")
      expect(await profileOf(sql, first)).toMatchObject({ enrolled_trigger: "academic_year_start", enrolled_on: start })
      expect(await statusOf(sql, deposit)).toBe("Interviewed")
      expect(await profileOf(sql, deposit)).toBeNull()
    })
  })

  test("a lead already Enrolled is left as it is, and so is a Declined one", async () => {
    const { year, start } = await yearStartingJanuary10()
    const full = await passedLead(year)
    await pay(full, 2_000_000, { type: "full_payment" })
    const declined = await passedLead(year)
    await pay(declined, 800_000, { type: "first_instalment" })
    await asSystem((sql) =>
      sql.query("update public.leads set status = 'Declined', declined_reason = 'Enrolled elsewhere' where id = $1", [declined]),
    )

    await inRolledBackTransaction(async (sql) => {
      const before = await profileOf(sql, full)
      await enrol(sql, start)
      expect(await statusOf(sql, full)).toBe("Enrolled")
      expect(await profileOf(sql, full)).toEqual(before)
      expect(await statusOf(sql, declined)).toBe("Declined")
      expect(await profileOf(sql, declined)).toBeNull()
    })
  })

  test("refuses a missing date", async () => {
    await inRolledBackTransaction(async (sql) => {
      await expect(sql.query("select public.enrol_from_academic_year_start(null)")).rejects.toThrow("invalid")
    })
  })
})

describe("a First instalment reached after the start", () => {
  test("enrols the lead the moment the payment is recorded, triggered by the payment", async () => {
    const { year } = await yearStartingJanuary10()
    const first = await passedLead(year)
    const deposit = await passedLead(year)

    await inRolledBackTransaction(async (sql) => {
      await pastYear(sql, "january-11", [first, deposit])
      const payment = await recordAsAccountant(sql, first, "first_instalment", 800_000, yesterday)
      await recordAsAccountant(sql, deposit, "initial_deposit", 300_000, yesterday)

      expect(await statusOf(sql, first)).toBe("Enrolled")
      expect(await profileOf(sql, first)).toEqual({
        enrolled_trigger: "payment",
        enrolled_trigger_payment_id: payment,
        enrolled_on: yesterday,
        recompute_cause: "payment",
      })
      expect(await statusOf(sql, deposit)).toBe("Interviewed")
    })
  })
})

describe("setting a start of today or earlier", () => {
  test("enrols the year's First instalment leads at once, triggered by the start", async () => {
    const { year } = await yearStartingJanuary10()
    const first = await passedLead(year)
    const deposit = await passedLead(year)

    await inRolledBackTransaction(async (sql) => {
      const past = await pastYear(sql, "none", [first, deposit])
      await recordAsAccountant(sql, first, "first_instalment", 800_000, `${past}-01-05`)
      await recordAsAccountant(sql, deposit, "initial_deposit", 300_000, `${past}-01-05`)
      expect(await statusOf(sql, first)).toBe("Interviewed")

      await asStaff(sql, MANAGER.id)
      await sql.query("select public.set_academic_year($1, $2)", [
        past,
        JSON.stringify({ academic_year_start: `${past}-01-11`, academic_year_start_was: null }),
      ])
      await asOwner(sql)

      expect(await statusOf(sql, first)).toBe("Enrolled")
      expect(await profileOf(sql, first)).toMatchObject({
        enrolled_trigger: "academic_year_start",
        enrolled_on: `${past}-01-11`,
      })
      expect(await statusOf(sql, deposit)).toBe("Interviewed")
    })
  })
})

describe("a start saved while the enrolment runs", () => {
  // A start save locks its year's leads, then runs the enrolment across every
  // year. If the daily run could hold a lead of another year meanwhile, the
  // two would deadlock. Instead the save takes the enrolment's lock first, so
  // a run started alongside waits for the save rather than locking any lead.
  test("the enrolment waits for a start save in progress, and the save for a run in progress", async () => {
    const { year } = await yearStartingJanuary10()

    const blocked = (error: unknown) => (error as { code?: string }).code
    await inRolledBackTransaction(async (save) => {
      await save.query("select public.set_audit_actor('system')")
      await save.query("update public.fee_schedules set academic_year_start = $2 where enrollment_year = $1", [
        year,
        `${year}-01-12`,
      ])
      const caught = await inRolledBackTransaction(async (run) => {
        await run.query("set local lock_timeout = '200ms'")
        return enrol(run, today).then(
          () => null,
          (error) => blocked(error),
        )
      })
      // 55P03: lock_not_available, when lock_timeout runs out.
      expect(caught).toBe("55P03")
    })

    await inRolledBackTransaction(async (run) => {
      await enrol(run, today)
      const caught = await inRolledBackTransaction(async (save) => {
        await save.query("set local lock_timeout = '200ms'")
        await save.query("select public.set_audit_actor('system')")
        return save
          .query("update public.fee_schedules set academic_year_start = $2 where enrollment_year = $1", [year, `${year}-01-12`])
          .then(
            () => null,
            (error) => blocked(error),
          )
      })
      expect(caught).toBe("55P03")
    })
  })
})

describe("the daily job", () => {
  test("runs just after midnight Tanzania time, 21:05 UTC, calling the enrolment as the system", async () => {
    const jobs = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query(
        "select schedule, command, active, username from cron.job where jobname = 'enrol-on-academic-year-start'",
      )
      return rows
    })
    expect(jobs).toEqual([
      {
        schedule: "5 21 * * *",
        command: "select public.enrol_on_academic_year_start_daily()",
        active: true,
        username: "postgres",
      },
    ])
  })

  test("enrols as the system, so the lead history names the System", async () => {
    const { year, start } = await yearStartingJanuary10()
    const first = await passedLead(year)
    await pay(first, 800_000, { type: "first_instalment" })

    await inRolledBackTransaction(async (sql) => {
      const { rows: [{ last }] } = await sql.query("select coalesce(max(id), 0) as last from public.audit_log")
      const { rows } = await sql.query("select public.enrol_on_academic_year_start_daily($1) as enrolled", [start])
      expect(rows[0].enrolled).toBeGreaterThanOrEqual(1)
      expect(await statusOf(sql, first)).toBe("Enrolled")

      const history = await sql.query(
        `select table_name, action, actor_kind, actor_staff_id, new_values ->> 'status' as status
         from public.audit_log
         where lead_id = $1 and id > $2
         order by id`,
        [first, last],
      )
      expect(history.rows).toEqual([
        { table_name: "lead_fee_profiles", action: "insert", actor_kind: "system", actor_staff_id: null, status: null },
        { table_name: "leads", action: "update", actor_kind: "system", actor_staff_id: null, status: "Enrolled" },
      ])
    })
  })

  test("without a date it enrols as of today in Tanzania, and before the start that is nobody of the year", async () => {
    const { year } = await yearStartingJanuary10()
    const first = await passedLead(year)
    await pay(first, 800_000, { type: "first_instalment" })

    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.enrol_on_academic_year_start_daily()")
      expect(await statusOf(sql, first)).toBe("Interviewed")
    })
  })

  test("no API role may run the enrolment or the job's call", async () => {
    const granted = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query(
        `select r.role, f.fn, has_function_privilege(r.role, f.fn, 'execute') as granted
         from unnest(array['anon', 'authenticated', 'service_role']) r (role)
         cross join unnest(array[
           'public.enrol_from_academic_year_start(date)',
           'public.enrol_on_academic_year_start_daily(date)'
         ]) f (fn)`,
      )
      return rows.filter((row) => row.granted)
    })
    expect(granted).toEqual([])
  })
})
