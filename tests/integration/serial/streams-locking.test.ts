import { randomInt, randomUUID } from "node:crypto"

import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, onTestFinished, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"

import { actAsStaff, asSystem, signedIn } from "../../support/db"
import { claimFeeYear } from "../../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../../support/fixtures"

// The seat lock's one rule, with two real sessions (#449, slice 4a): after
// the seat lock, a transaction never waits for a lead row another one holds.
// The seat mode is switched to `named` and committed here, which no other
// test may see, so this file runs in integration-serial: after every other
// file, and alone. It puts the mode back and removes its streams at the end.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))
const daysAgo = (n: number) => tanzaniaToday(new Date(Date.now() - n * DAY))

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

function session(): Client {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  onTestFinished(async () => {
    await client.query("rollback").catch(() => {})
    await client.end().catch(() => {})
  })
  return client
}

async function setMode(mode: "legacy" | "named") {
  await asSystem((sql) => sql.query("update public.seat_settings set mode = $1", [mode]))
}

const years: number[] = []

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  years.push(claim.year)
  return claim.year
}

async function child(year: number, className: string): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Seat Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}` } },
    student: { fullName: `Seats ${randomUUID().slice(0, 8)}`, className: className as never, enrollmentYear: thisYear + 1, dayOrBoarding: "Day", gender: "Boy" },
    start: { kind: "walk-in", visitDate: daysAgo(1) },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  return id
}

// Local databases keep every committed lead, and fee test years are reused,
// so each test takes a class where nobody in its year holds a seat yet.
async function emptyClass(year: number): Promise<string> {
  const { rows } = await asSystem((sql) =>
    sql.query<{ class_name: string }>("select distinct class_name::text from public.seat_holders($1)", [year]),
  )
  const taken = new Set(rows.map((r) => r.class_name))
  const free = ["STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7", "KG 1", "KG 2", "FORM 1", "FORM 2", "FORM 3"].find((c) => !taken.has(c))
  if (!free) throw new Error(`every class of ${year} has seat holders`)
  return free
}

async function streamOf(leadId: string): Promise<string | null> {
  return asSystem(async (sql) => {
    const { rows } = await sql.query<{ label: string | null }>(
      "select s.label from public.seat_placements p left join public.streams s on s.id = p.stream_id where p.lead_id = $1",
      [leadId],
    )
    return rows[0]?.label ?? null
  })
}

beforeAll(async () => {
  await setMode("named")
})

afterAll(async () => {
  await setMode("legacy")
  // Streams refuse deletes; this file's are removed so a later run that
  // claims the same years starts clean. The replica role skips the refusal
  // triggers for this transaction only, without altering a table.
  if (years.length === 0) return
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("begin")
    await sql.query("set local session_replication_role = replica")
    await sql.query(
      "delete from public.seat_placements where stream_id in (select id from public.streams where enrollment_year = any ($1))",
      [years],
    )
    await sql.query("delete from public.seat_sync_queue")
    await sql.query("delete from public.streams where enrollment_year = any ($1)", [years])
    await sql.query("commit")
  } finally {
    await sql.end()
  }
})

describe("the seat lock never waits for a lead row", () => {
  test("opening a stream skips a waiting child whose row is busy, and the retry places them later", async () => {
    const year = await yearWithSchedule()
    const cls = await emptyClass(year)
    const waiting = await child(year, cls)
    const paid = await recordPayment(await signedIn(ACCOUNTANT), waiting, { type: "initial_deposit", amount: 300_000, paidOn: daysAgo(2) }, randomUUID())
    if (!paid.ok) throw new Error("payment failed")

    // Another transaction holds the child's row, as a payment or a decline would.
    const busy = session()
    await busy.connect()
    await busy.query("begin")
    await busy.query("select 1 from public.leads where id = $1 for update", [waiting])

    const manager = session()
    await manager.connect()
    await manager.query("set lock_timeout = '3s'")
    await manager.query("begin")
    await actAsStaff(manager, MANAGER.id)
    await manager.query("select public.open_stream($1, $2, 'A', 'Mixed', 5, $3)", [year, cls, randomUUID()])
    await manager.query("commit")

    expect(await streamOf(waiting)).toBeNull()
    const queued = await asSystem((sql) => sql.query("select count(*)::int as n from public.seat_sync_queue where lead_id = $1 and retry", [waiting]))
    expect(queued.rows[0].n).toBe(1)

    await busy.query("commit")
    const ran = await asSystem((sql) => sql.query<{ n: number }>("select public.run_seat_retries() as n"))
    expect(ran.rows[0].n).toBeGreaterThanOrEqual(1)
    expect(await streamOf(waiting)).toBe("A")
  })

  test("a payment and an opening stream at once both finish, and the payer takes the new seat at commit", async () => {
    const year = await yearWithSchedule()
    const cls = await emptyClass(year)
    const payer = await child(year, cls)

    // The payment: Family lock and the lead's row, then the seat lock at commit.
    const accountant = session()
    await accountant.connect()
    await accountant.query("set lock_timeout = '5s'")
    await accountant.query("begin")
    await actAsStaff(accountant, ACCOUNTANT.id)
    await accountant.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [payer, today, randomUUID()])

    // The opening, beside it: the fee schedule row, then the seat lock. It
    // sees no committed priority for the payer and doesn't wait for the row.
    const manager = session()
    await manager.connect()
    await manager.query("set lock_timeout = '5s'")
    await manager.query("begin")
    await actAsStaff(manager, MANAGER.id)
    await manager.query("select public.open_stream($1, $2, 'A', 'Boys', 1, $3)", [year, cls, randomUUID()])
    await manager.query("commit")

    // The payment commits: its queued sync takes the seat lock and places the payer.
    await accountant.query("commit")
    expect(await streamOf(payer)).toBe("A")
  })

  test("a decline beside a payment for the seat it frees: both finish, and the payer takes it", async () => {
    const year = await yearWithSchedule()
    const cls = await emptyClass(year)
    const [leaving, payer] = [await child(year, cls), await child(year, cls)]
    const paid = await recordPayment(await signedIn(ACCOUNTANT), leaving, { type: "initial_deposit", amount: 300_000, paidOn: daysAgo(3) }, randomUUID())
    if (!paid.ok) throw new Error("payment failed")
    const opener = session()
    await opener.connect()
    await opener.query("begin")
    await actAsStaff(opener, MANAGER.id)
    await opener.query("select public.open_stream($1, $2, 'A', 'Mixed', 1, $3)", [year, cls, randomUUID()])
    await opener.query("commit")
    expect(await streamOf(leaving)).toBe("A")

    const decline = session()
    const pay = session()
    await Promise.all([decline.connect(), pay.connect()])
    for (const s of [decline, pay]) {
      await s.query("set lock_timeout = '5s'")
      await s.query("begin")
    }
    await actAsStaff(decline, MANAGER.id)
    await actAsStaff(pay, ACCOUNTANT.id)
    await decline.query("select public.decline_lead($1, 'No seat available', null)", [leaving])
    await pay.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [payer, today, randomUUID()])
    await Promise.all([pay.query("commit"), decline.query("commit")])
    // The payer committed either before the seat was free (and waits until
    // the decline's sync) or after; either way the seat ends up theirs.
    await asSystem((sql) => sql.query("select public.run_seat_retries()"))
    expect([await streamOf(leaving), await streamOf(payer)]).toEqual([null, "A"])
  })

  test("lowering a stream's seats beside a payment: both finish and nobody is over the seats", async () => {
    const year = await yearWithSchedule()
    const cls = await emptyClass(year)
    const payer = await child(year, cls)
    const opener = session()
    await opener.connect()
    await opener.query("begin")
    await actAsStaff(opener, MANAGER.id)
    const opened = await opener.query("select public.open_stream($1, $2, 'A', 'Mixed', 1, $3) as s", [year, cls, randomUUID()])
    await opener.query("commit")

    const pay = session()
    const edit = session()
    await Promise.all([pay.connect(), edit.connect()])
    for (const s of [pay, edit]) {
      await s.query("set lock_timeout = '5s'")
      await s.query("begin")
    }
    await actAsStaff(pay, ACCOUNTANT.id)
    await actAsStaff(edit, MANAGER.id)
    await pay.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [payer, today, randomUUID()])
    await edit.query("select public.edit_stream($1, 'A', 0)", [opened.rows[0].s.id])
    await Promise.all([edit.query("commit"), pay.query("commit")])
    const count = await asSystem((sql) =>
      sql.query<{ placed: number; seats: number }>(
        "select s.seats, (select count(*)::int from public.seat_placements p where p.stream_id = s.id) as placed from public.streams s where s.id = $1",
        [opened.rows[0].s.id],
      ),
    )
    expect(count.rows[0].placed).toBeLessThanOrEqual(count.rows[0].seats)
  })

  test("two sessions paying for the last seat: one is placed, the other waits, and nobody is over the seats", async () => {
    const year = await yearWithSchedule()
    const cls = await emptyClass(year)
    const [first, second] = [await child(year, cls), await child(year, cls)]
    const opener = session()
    await opener.connect()
    await opener.query("begin")
    await actAsStaff(opener, MANAGER.id)
    await opener.query("select public.open_stream($1, $2, 'A', 'Mixed', 1, $3)", [year, cls, randomUUID()])
    await opener.query("commit")

    const a = session()
    const b = session()
    await Promise.all([a.connect(), b.connect()])
    for (const s of [a, b]) {
      await s.query("set lock_timeout = '5s'")
      await s.query("begin")
      await actAsStaff(s, ACCOUNTANT.id)
    }
    await a.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [first, today, randomUUID()])
    await b.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [second, today, randomUUID()])
    await Promise.all([a.query("commit"), b.query("commit")])

    const placed = [await streamOf(first), await streamOf(second)].filter(Boolean)
    expect(placed).toEqual(["A"])
  })
})
