import { randomInt, randomUUID } from "node:crypto"

import { Client } from "pg"
import { afterAll, describe, expect, onTestFinished, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"

import { actAsStaff, asSystem, signedIn } from "../../support/db"
import { claimFeeYear } from "../../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../../support/fixtures"
import { removeStreams } from "../../support/streams"

// The seat lock's one rule, with two real sessions (#449, slice 4a): after
// the seat lock, a transaction never waits for a lead row another one holds.
// It commits streams and holds lead rows in open transactions, which no
// other test may meet, so this file runs in integration-serial: after every
// other file, and alone. It removes its streams at the end.

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

// Streams refuse deletes; this file's are removed so a later run that claims
// the same years finds no seat limit there.
afterAll(() => removeStreams(years))

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

  test("a child left waiting while their row is busy is retried and recorded as waiting, keeping their turn", async () => {
    const year = await yearWithSchedule()
    const cls = await emptyClass(year)
    const girl = await child(year, cls)
    await asSystem((sql) => sql.query("update public.leads set gender = 'Girl' where id = $1", [girl]))
    const paid = await recordPayment(await signedIn(ACCOUNTANT), girl, { type: "initial_deposit", amount: 300_000, paidOn: daysAgo(4) }, randomUUID())
    if (!paid.ok) throw new Error("payment failed")

    const busy = session()
    await busy.connect()
    await busy.query("begin")
    await busy.query("select 1 from public.leads where id = $1 for update", [girl])

    // The first stream is for boys: she waits, but her row is busy.
    const manager = session()
    await manager.connect()
    await manager.query("set lock_timeout = '3s'")
    await manager.query("begin")
    await actAsStaff(manager, MANAGER.id)
    await manager.query("select public.open_stream($1, $2, 'A', 'Boys', 5, $3)", [year, cls, randomUUID()])
    await manager.query("commit")
    const retry = await asSystem((sql) => sql.query("select count(*)::int as n from public.seat_sync_queue where lead_id = $1 and retry", [girl]))
    expect(retry.rows[0].n).toBe(1)

    await busy.query("commit")
    await asSystem((sql) => sql.query("select public.run_seat_retries()"))
    const waiting = await asSystem((sql) =>
      sql.query<{ cls: string }>("select waiting_class::text as cls from public.seat_placements where lead_id = $1", [girl]),
    )
    expect(waiting.rows[0]?.cls).toBe(cls)
  })

  // Slice 4b: a first booking runs the seat sync inside the payment and keeps
  // the seat lock until it commits, so whoever comes second waits for it.
  /** A statement's error message, or "no refusal", without throwing. */
  const outcome = (run: Promise<unknown>) => run.then(() => "no refusal", (error: Error) => error.message)

  test("a request whose child's row is busy when a fitting stream opens is closed by the retry", async () => {
    const year = await yearWithSchedule()
    const cls = await emptyClass(year)
    const holderId = await child(year, cls)
    const paid = await recordPayment(await signedIn(ACCOUNTANT), holderId, { type: "initial_deposit", amount: 300_000, paidOn: daysAgo(4) }, randomUUID())
    if (!paid.ok) throw new Error("payment failed")
    const asking = await child(year, cls)

    // One full stream, and a request for the child who can't pay.
    const manager = session()
    await manager.connect()
    await manager.query("set lock_timeout = '3s'")
    await manager.query("begin")
    await actAsStaff(manager, MANAGER.id)
    await manager.query("select public.open_stream($1, $2, 'A', 'Boys', 1, $3)", [year, cls, randomUUID()])
    await manager.query("commit")
    const request = await asSystem(async (sql) => {
      await actAsStaff(sql, ADMISSIONS.id)
      return (await sql.query("select public.request_stream($1, null, null, null) as r", [asking])).rows[0].r.id as string
    })

    // A correction holds the child's row while a second stream opens.
    const busy = session()
    await busy.connect()
    await busy.query("begin")
    await busy.query("select 1 from public.leads where id = $1 for update", [asking])
    await manager.query("begin")
    await actAsStaff(manager, MANAGER.id)
    await manager.query("select public.open_stream($1, $2, 'B', 'Boys', 1, $3)", [year, cls, randomUUID()])
    await manager.query("commit")
    const open = async () =>
      (await asSystem((sql) => sql.query<{ done: boolean }>("select resolved_at is not null as done from public.stream_requests where id = $1", [request]))).rows[0].done
    expect(await open()).toBe(false)

    await busy.query("commit")
    await asSystem((sql) => sql.query("select public.run_seat_retries()"))
    expect(await open()).toBe(true)
  })

  test("a request left open on a busy row gives its child no turn: paying in full later, he still comes after the girl already waiting", async () => {
    const year = await yearWithSchedule()
    const cls = await emptyClass(year)
    const accountant = await signedIn(ACCOUNTANT)
    const [seated, girl, asking] = [await child(year, cls), await child(year, cls), await child(year, cls)]
    await asSystem((sql) => sql.query("update public.leads set gender = 'Girl' where id = $1", [girl]))
    for (const [id, days] of [[seated, 6], [girl, 4]] as const) {
      const paid = await recordPayment(accountant, id, { type: "initial_deposit", amount: 300_000, paidOn: daysAgo(days) }, randomUUID())
      if (!paid.ok) throw new Error("payment failed")
    }

    // The boys' stream is full: the girl waits, and the boy who hasn't paid asks for a stream.
    const manager = session()
    await manager.connect()
    await manager.query("set lock_timeout = '3s'")
    const openStream = async (label: string, takes: string) => {
      await manager.query("begin")
      await actAsStaff(manager, MANAGER.id)
      await manager.query("select public.open_stream($1, $2, $3, $4, 1, $5)", [year, cls, label, takes, randomUUID()])
      await manager.query("commit")
    }
    await openStream("A", "Boys")
    expect([await streamOf(seated), await streamOf(girl)]).toEqual(["A", null])
    const request = await asSystem(async (sql) => {
      await actAsStaff(sql, ADMISSIONS.id)
      return (await sql.query("select public.request_stream($1, null, null, null) as r", [asking])).rows[0].r.id as string
    })

    // Both rows are busy while a mixed stream and then a boys' stream open:
    // her seat in B is counted but not written, and his request, answered
    // by C, can't be closed.
    const busy = session()
    await busy.connect()
    await busy.query("begin")
    await busy.query("select 1 from public.leads where id = any ($1) for update", [[girl, asking]])
    await openStream("B", "Mixed")
    await openStream("C", "Boys")
    const closed = async () =>
      (await asSystem((sql) => sql.query<{ done: boolean }>("select resolved_at is not null as done from public.stream_requests where id = $1", [request]))).rows[0].done
    expect(await closed()).toBe(false)
    expect([await streamOf(girl), await streamOf(asking)]).toEqual([null, null])
    await busy.query("commit")

    // Before any other sync, he pays in full. Full ranks above her Deposit,
    // but she was waiting first: she takes B, and he takes C.
    const fee = await asSystem((sql) => sql.query<{ school_fee: number }>("select school_fee from public.lead_seat_priority($1)", [asking]))
    const paid = await recordPayment(accountant, asking, { type: "full_payment", amount: fee.rows[0].school_fee, paidOn: today }, randomUUID())
    expect(paid).toMatchObject({ ok: true, data: { priority: "Full" } })
    expect([await streamOf(girl), await streamOf(asking)]).toEqual(["B", "C"])
    expect(await closed()).toBe(true)
  })

  test("a payment and an opening stream at once both finish, and the payer takes the new seat", async () => {
    const year = await yearWithSchedule()
    const cls = await emptyClass(year)
    const payer = await child(year, cls)

    // No streams yet, so nothing blocks the payment; it holds the seat lock.
    const accountant = session()
    await accountant.connect()
    await accountant.query("set lock_timeout = '5s'")
    await accountant.query("begin")
    await actAsStaff(accountant, ACCOUNTANT.id)
    await accountant.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [payer, today, randomUUID()])

    // The opening waits for the seat lock, then sees the payer's priority.
    const manager = session()
    await manager.connect()
    await manager.query("set lock_timeout = '5s'")
    await manager.query("begin")
    await actAsStaff(manager, MANAGER.id)
    const opening = outcome(manager.query("select public.open_stream($1, $2, 'A', 'Boys', 1, $3)", [year, cls, randomUUID()]))
    await accountant.query("commit")
    expect(await opening).toBe("no refusal")
    await manager.query("commit")
    expect(await streamOf(payer)).toBe("A")
  })

  test("a payment beside a decline that hasn't committed is refused; once it has, the payer takes the freed seat", async () => {
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
    // The seat isn't free until the decline commits.
    expect(await outcome(pay.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [payer, today, randomUUID()]))).toBe("no_class")
    await pay.query("rollback")
    await decline.query("commit")

    const again = await recordPayment(await signedIn(ACCOUNTANT), payer, { type: "initial_deposit", amount: 300_000, paidOn: today }, randomUUID())
    expect(again.ok).toBe(true)
    expect([await streamOf(leaving), await streamOf(payer)]).toEqual([null, "A"])
  })

  test("lowering a stream's seats beside a payment that took the last one is refused, and nobody is over the seats", async () => {
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
    const editing = outcome(edit.query("select public.edit_stream($1, 'A', 0)", [opened.rows[0].s.id]))
    await pay.query("commit")
    expect(await editing).toBe("below_placed")
    await edit.query("rollback")
    expect(await streamOf(payer)).toBe("A")
  })

  test("two sessions paying for the last seat: one is placed, the other's whole payment is refused", async () => {
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
    // Both saw the seat free; the second waits for the first's seat lock and
    // is then refused under it.
    const paying = outcome(b.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [second, today, randomUUID()]))
    await a.query("commit")
    expect(await paying).toBe("no_class")
    await b.query("rollback")

    expect([await streamOf(first), await streamOf(second)]).toEqual(["A", null])
    const kept = await asSystem((sql) => sql.query<{ n: number }>("select count(*)::int as n from public.school_fee_payments where lead_id = $1", [second]))
    expect(kept.rows[0].n).toBe(0)
  })
})
