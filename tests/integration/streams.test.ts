import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { afterAll, describe, expect, onTestFinished, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead, type StudentGender } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"

import { actAsStaff, asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { claimFeeYear, FEE_YEARS } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Streams, switched off (#449, slice 4a). Every test switches the seat mode
// to `named` inside its own rolled-back transaction, so nothing here is seen
// by the rest of the suite. Children get their Seat priority from committed
// payments in a claimed fee year; streams are opened in the transaction.
// Queued syncs run at commit, which a rolled-back test never reaches, so the
// tests call flush_seat_queue() themselves.

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

// The tests share one claimed year, so they save few fee schedules (other
// files compare fee_schedules rows while they run), and take another only
// when the shared year has no class left without seat holders.
const releases: (() => Promise<void>)[] = []
afterAll(async () => {
  for (const release of releases) await release()
})
let shared: number | null = null

async function claimYear(): Promise<number> {
  const claim = await claimFeeYear()
  releases.push(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

async function yearWithSchedule(): Promise<number> {
  shared ??= await claimYear()
  return shared
}

/** The shared year and `n` of its classes where nobody holds a seat yet. */
async function yearAndClasses(n: number): Promise<{ year: number; classes: string[] }> {
  const year = await yearWithSchedule()
  const classes = await emptyClasses(year, n).catch(() => null)
  if (classes) return { year, classes }
  shared = await claimYear()
  return { year: shared, classes: await emptyClasses(shared, n) }
}

/** Two years in a row, each with a schedule: the year streams come up from, and the next. */
async function twoYearsWithSchedules(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = await claimFeeYear({ first: FEE_YEARS.first, last: FEE_YEARS.last - 1 })
    const next = await claimFeeYear({ first: first.year + 1, last: first.year + 1 }).catch(() => null)
    if (!next) {
      await first.release()
      continue
    }
    onTestFinished(first.release)
    onTestFinished(next.release)
    const accountant = await signedIn(ACCOUNTANT)
    for (const year of [first.year, next.year]) {
      const saved = await saveFeeAmounts(accountant, year, AMOUNTS)
      if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
    }
    return first.year
  }
  throw new Error("No two fee test years in a row were free")
}

// Local databases keep every committed lead and reuse fee test years, so a
// test that counts seats takes classes where nobody in its year holds one.
async function emptyClasses(year: number, n: number): Promise<string[]> {
  const { rows } = await asSystem((sql) =>
    sql.query<{ class_name: string }>("select distinct class_name::text from public.seat_holders($1)", [year]),
  )
  const taken = new Set(rows.map((r) => r.class_name))
  const free = ["DAY CARE", "KG 1", "KG 2", "STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7", "FORM 1", "FORM 2", "FORM 3"].filter((c) => !taken.has(c))
  if (free.length < n) throw new Error(`not enough classes of ${year} without seat holders`)
  return free.slice(0, n)
}

const phone = () => `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`

/** A child of `year` and `className` who passed their interview, with no payment yet. */
async function child(year: number, className: string, gender?: StudentGender): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Stream Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: phone() } },
    student: {
      fullName: `Stream ${randomUUID().slice(0, 8)}`,
      className: className as never,
      enrollmentYear: thisYear + 1,
      dayOrBoarding: "Day",
      ...(gender ? { gender } : {}),
    },
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

/** A child holding a Deposit priority reached `paidDaysAgo` days ago (older ranks first). */
async function holder(year: number, className: string, gender: StudentGender | undefined, paidDaysAgo: number): Promise<string> {
  const id = await child(year, className, gender)
  const paid = await recordPayment(await signedIn(ACCOUNTANT), id, { type: "initial_deposit", amount: 300_000, paidOn: daysAgo(paidDaysAgo) }, randomUUID())
  if (!paid.ok) throw new Error(`payment failed: ${JSON.stringify(paid.error)}`)
  return id
}

/** Switches this transaction to streams and acts as the Manager. */
async function named(sql: Client) {
  await sql.query("select public.set_audit_actor('system')")
  await sql.query("update public.seat_settings set mode = 'named'")
  await actAsStaff(sql, MANAGER.id)
}

async function asOwner(sql: Client) {
  await sql.query("reset role")
}

type Stream = { id: string; label: string; takes: string; seats: number; position: number; placed: number }

async function open(sql: Client, year: number, className: string, label: string, takes: string, seats: number): Promise<Stream> {
  const { rows } = await sql.query<{ s: Stream }>("select public.open_stream($1, $2, $3, $4, $5, $6) as s", [
    year, className, label, takes, seats, randomUUID(),
  ])
  return rows[0].s
}

async function placements(sql: Client, ids: string[]): Promise<Record<string, string | null>> {
  const { rows } = await sql.query<{ lead_id: string; label: string | null }>(
    `select l.id as lead_id, s.label
     from public.leads l
     left join public.seat_placements p on p.lead_id = l.id
     left join public.streams s on s.id = p.stream_id
     where l.id = any ($1)`,
    [ids],
  )
  return Object.fromEntries(ids.map((id) => [id, rows.find((r) => r.lead_id === id)?.label ?? null]))
}

async function refusal(sql: Client, query: string, params: unknown[]): Promise<string> {
  await sql.query("savepoint refusal")
  try {
    await sql.query(query, params)
    return "no refusal"
  } catch (error) {
    return (error as Error).message
  } finally {
    await sql.query("rollback to savepoint refusal")
  }
}

describe("while the seat mode is legacy", () => {
  test("streams can't be opened, edited or brought up, and a recompute queues nothing", async () => {
    const year = await yearWithSchedule()
    const id = await child(year, "FORM 1", "Boy")
    await inRolledBackTransaction(async (sql) => {
      await actAsStaff(sql, MANAGER.id)
      expect(await refusal(sql, "select public.open_stream($1, 'FORM 1', 'A', 'Boys', 30, $2)", [year, randomUUID()])).toBe("seat_mode_legacy")
      expect(await refusal(sql, "select public.bring_up_streams($1, array[gen_random_uuid()])", [year])).toBe("seat_mode_legacy")
      await asOwner(sql)
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.recompute_lead_fee($1, 'lead_details')", [id])
      const { rows } = await sql.query("select count(*)::int as n from public.seat_sync_queue where lead_id = $1", [id])
      expect(rows[0].n).toBe(0)
    })
  })
})

describe("opening streams", () => {
  test("the first stream places the children it takes, in ranking order, up to its seats; the rest wait", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const firstBoy = await holder(year, c, "Boy", 5)
    const girl = await holder(year, c, "Girl", 4)
    const noAnswer = await holder(year, c, undefined, 3)
    const laterBoy = await holder(year, c, "Boy", 2)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const boys = await open(sql, year, c, "A", "Boys", 1)
      expect(boys).toMatchObject({ label: "A", takes: "Boys", seats: 1, position: 1, placed: 1 })
      await asOwner(sql)
      expect(await placements(sql, [firstBoy, girl, noAnswer, laterBoy])).toEqual({ [firstBoy]: "A", [girl]: null, [noAnswer]: null, [laterBoy]: null })

      // A Girls stream may share the label; a Mixed one comes next and takes
      // the child with no answer and the boy still waiting, in rank order.
      await actAsStaff(sql, MANAGER.id)
      expect(await open(sql, year, c, "A", "Girls", 5)).toMatchObject({ position: 2, placed: 1 })
      expect(await open(sql, year, c, "B", "Mixed", 1)).toMatchObject({ position: 3, placed: 1 })
      await asOwner(sql)
      expect(await placements(sql, [firstBoy, girl, noAnswer, laterBoy])).toEqual({ [firstBoy]: "A", [girl]: "A", [noAnswer]: "B", [laterBoy]: null })
    })
  })

  test("labels: Boys and Girls may share one, Mixed may share with neither, and case doesn't count", async () => {
    const year = await yearWithSchedule()
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, "STD 6", "A", "Boys", 10)
      await open(sql, year, "STD 6", "A", "Girls", 10)
      expect(await refusal(sql, "select public.open_stream($1, 'STD 6', 'a', 'Mixed', 10, $2)", [year, randomUUID()])).toBe("label_taken")
      expect(await refusal(sql, "select public.open_stream($1, 'STD 6', ' a ', 'Boys', 10, $2)", [year, randomUUID()])).toBe("label_taken")
      expect(await refusal(sql, "select public.open_stream($1, 'STD 6', 'C', 'Boys', 0, $2)", [year, randomUUID()])).toBe("invalid")
      await open(sql, year, "STD 6", "B", "Boys", 10)
      await asOwner(sql)
      const next = async (takes: string) =>
        (await sql.query<{ l: string }>("select public.next_stream_label($1, 'STD 6', $2) as l", [year, takes])).rows[0].l
      expect(await next("Boys")).toBe("C")
      expect(await next("Girls")).toBe("B")
      expect(await next("Mixed")).toBe("C")
    })
  })

  test("after Z the labels run AA, AB", async () => {
    const year = await yearWithSchedule()
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      for (let i = 0; i < 26; i++) await open(sql, year, "KG 1", String.fromCharCode(65 + i), "Mixed", 1)
      await asOwner(sql)
      const { rows } = await sql.query<{ l: string }>("select public.next_stream_label($1, 'KG 1', 'Mixed') as l", [year])
      expect(rows[0].l).toBe("AA")
    })
  })

  test("a retry with the same request hands back the stream already opened", async () => {
    const year = await yearWithSchedule()
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const request = randomUUID()
      const first = await sql.query("select public.open_stream($1, 'STD 3', 'A', 'Mixed', 20, $2) as s", [year, request])
      const again = await sql.query("select public.open_stream($1, 'STD 3', 'A', 'Mixed', 20, $2) as s", [year, request])
      expect(again.rows[0].s.id).toBe(first.rows[0].s.id)
    })
  })

  test("only staff who may manage academic years open, edit or bring up streams", async () => {
    const year = await yearWithSchedule()
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.seat_settings set mode = 'named'")
      await actAsStaff(sql, ADMISSIONS.id)
      expect(await refusal(sql, "select public.open_stream($1, 'STD 3', 'A', 'Mixed', 20, $2)", [year, randomUUID()])).toBe("not_permitted")
      expect(await refusal(sql, "select public.edit_stream(gen_random_uuid(), 'A', 3)", [])).toBe("not_permitted")
      expect(await refusal(sql, "select public.bring_up_streams($1, array[gen_random_uuid()])", [year])).toBe("not_permitted")
    })
  })
})

describe("editing a stream", () => {
  test("seats never go below the children placed; raising them places a waiting child", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const first = await holder(year, c, "Girl", 5)
    const second = await holder(year, c, "Boy", 4)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const stream = await open(sql, year, c, "A", "Mixed", 1)
      expect(await refusal(sql, "select public.edit_stream($1, 'A', 0)", [stream.id])).toBe("below_placed")
      await sql.query("select public.edit_stream($1, 'Ruby', 2)", [stream.id])
      await asOwner(sql)
      expect(await placements(sql, [first, second])).toEqual({ [first]: "Ruby", [second]: "Ruby" })
    })
  })
})

describe("the seat sync", () => {
  test("a new Seat priority takes a free seat at the end of the transaction, after the children already waiting", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const waiting = await holder(year, c, "Boy", 10)
    const newcomer = await child(year, c, "Boy")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      // No seat while the stream is full: the earlier holder waits.
      const stream = await open(sql, year, c, "A", "Boys", 1)
      await asOwner(sql)
      expect(await placements(sql, [waiting])).toEqual({ [waiting]: "A" })
      // Make room for one more, then the newcomer pays.
      await actAsStaff(sql, MANAGER.id)
      await sql.query("select public.edit_stream($1, 'A', 2)", [stream.id])
      await asOwner(sql)
      await actAsStaff(sql, ACCOUNTANT.id)
      await sql.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [newcomer, today, randomUUID()])
      await asOwner(sql)
      const { rows } = await sql.query("select count(*)::int as n from public.seat_sync_queue where lead_id = $1 and not retry", [newcomer])
      expect(rows[0].n).toBe(1)
      await sql.query("select public.flush_seat_queue()")
      expect(await placements(sql, [waiting, newcomer])).toEqual({ [waiting]: "A", [newcomer]: "A" })
    })
  })

  test("a waiting child takes the seat a declined child gives back", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const placed = await holder(year, c, "Girl", 6)
    const waiting = await holder(year, c, "Girl", 3)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 1)
      await asOwner(sql)
      expect(await placements(sql, [placed, waiting])).toEqual({ [placed]: "A", [waiting]: null })
      await actAsStaff(sql, MANAGER.id)
      await sql.query("select public.decline_lead($1, 'No seat available', null)", [placed])
      await asOwner(sql)
      await sql.query("select public.flush_seat_queue()")
      expect(await placements(sql, [placed, waiting])).toEqual({ [placed]: null, [waiting]: "A" })
    })
  })

  test("a gender correction moves a child out of a stream that no longer takes them, and leaves a Mixed one alone", async () => {
    const { year, classes: [c, c2] } = await yearAndClasses(2)
    const boy = await holder(year, c, "Boy", 6)
    const mixedChild = await holder(year, c2, "Boy", 6)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Boys", 5)
      await open(sql, year, c, "A", "Girls", 5)
      await open(sql, year, c2, "A", "Mixed", 5)
      await asOwner(sql)
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.leads set gender = 'Girl' where id = any ($1)", [[boy, mixedChild]])
      await sql.query("select public.flush_seat_queue()")
      const { rows } = await sql.query<{ lead_id: string; takes: string }>(
        "select p.lead_id, s.takes from public.seat_placements p join public.streams s on s.id = p.stream_id where p.lead_id = any ($1)",
        [[boy, mixedChild]],
      )
      expect(Object.fromEntries(rows.map((r) => [r.lead_id, r.takes]))).toEqual({ [boy]: "Girls", [mixedChild]: "Mixed" })
    })
  })

  test("a child already waiting takes a freed seat before a higher-ranked newcomer queued in the same sweep", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const placed = await holder(year, c, "Girl", 20)
    const waiting = await holder(year, c, "Girl", 3)
    const newcomer = await child(year, c, "Girl")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 1)
      await asOwner(sql)
      // The waiting child was recorded by an earlier transaction.
      await sql.query("update public.seat_placements set waiting_xid = '1'::xid8 where lead_id = $1", [waiting])
      // In one transaction: the newcomer reaches a priority dated before the
      // waiting child's (so it ranks higher), and the placed child is declined.
      await actAsStaff(sql, ACCOUNTANT.id)
      await sql.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [newcomer, daysAgo(10), randomUUID()])
      await asOwner(sql)
      await actAsStaff(sql, MANAGER.id)
      await sql.query("select public.decline_lead($1, 'No seat available', null)", [placed])
      await asOwner(sql)
      await sql.query("select public.flush_seat_queue()")
      expect(await placements(sql, [placed, waiting, newcomer])).toEqual({ [placed]: null, [waiting]: "A", [newcomer]: null })
      const { rows } = await sql.query("select waiting_since is not null as waits from public.seat_placements where lead_id = $1", [newcomer])
      expect(rows[0].waits).toBe(true)
    })
  })

  test("a waiting child moved to another class stops waiting in the old one and waits afresh in the new", async () => {
    const { year, classes: [from, to, noStreams] } = await yearAndClasses(3)
    const placed = await holder(year, from, "Boy", 9)
    const mover = await holder(year, from, "Boy", 4)
    const waitingThere = await holder(year, to, "Boy", 2)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, from, "A", "Mixed", 1)
      await open(sql, year, to, "A", "Mixed", 0 + 1)
      await asOwner(sql)
      const waits = async (id: string) =>
        (await sql.query<{ cls: string | null; earlier: boolean | null }>(
          "select waiting_class::text as cls, waiting_xid <> pg_current_xact_id() as earlier from public.seat_placements where lead_id = $1",
          [id],
        )).rows[0] ?? { cls: null, earlier: null }
      expect(await placements(sql, [placed, mover, waitingThere])).toEqual({ [placed]: "A", [mover]: null, [waitingThere]: "A" })
      expect((await waits(mover)).cls).toBe(from)
      await sql.query("update public.seat_placements set waiting_xid = '1'::xid8 where lead_id = $1", [mover])

      // Corrected into a full class with streams: waits there, afresh.
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.leads set class_name = $2 where id = $1", [mover, to])
      await sql.query("select public.flush_seat_queue()")
      expect(await waits(mover)).toEqual({ cls: to, earlier: false })

      // Corrected into a class with no streams: no limit, so no waiting.
      await sql.query("update public.leads set class_name = $2 where id = $1", [mover, noStreams])
      await sql.query("select public.flush_seat_queue()")
      expect(await waits(mover)).toEqual({ cls: null, earlier: null })
    })
  })

  test("each placement keeps its own child's cause, and the queue's actor survives a cleared one", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const [first, second] = [await child(year, c, "Boy"), await child(year, c, "Girl")]
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 5)
      await asOwner(sql)
      await actAsStaff(sql, ACCOUNTANT.id)
      await sql.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [first, today, randomUUID()])
      await asOwner(sql)
      // A second child queued by a sibling recompute, then every actor
      // cleared, as some blocks do before the commit: the queue kept it.
      await actAsStaff(sql, ACCOUNTANT.id)
      await sql.query("select public.record_school_fee_payment($1, 'initial_deposit', 300000, $2, $3)", [second, today, randomUUID()])
      await asOwner(sql)
      await sql.query("update public.seat_sync_queue set cause = 'sibling' where lead_id = $1", [second])
      await sql.query("select set_config('request.jwt.claims', '', true), set_config('audit.actor_kind', '', true)")
      expect((await sql.query("select public.flush_seat_queue() as n")).rows[0].n).toBe(2)
      expect((await sql.query("select public.flush_seat_queue() as n")).rows[0].n).toBe(0)
      const { rows } = await sql.query<{ lead_id: string; cause: string; actor_kind: string }>(
        `select p.lead_id, p.cause, a.actor_kind
         from public.seat_placements p
         join public.audit_log a on a.row_id = p.id and a.table_name = 'seat_placements'
         where p.lead_id = any ($1)
         order by p.lead_id`,
        [[first, second]],
      )
      expect(Object.fromEntries(rows.map((r) => [r.lead_id, r.cause]))).toEqual({ [first]: "payment", [second]: "sibling" })
      expect(rows.map((r) => r.actor_kind)).toEqual(["staff", "staff"])
    })
  })

  test("placement never changes a fee, a status or a Seat priority", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const ids = [await holder(year, c, "Boy", 4), await holder(year, c, "Girl", 3)]
    await inRolledBackTransaction(async (sql) => {
      // fee_snapshot()'s fields for these children: the fee, its parts, the
      // discount, what is paid, the status and the priority.
      const snapshot = `select l.id, l.status, l.closure, to_jsonb(fee) as fee, to_jsonb(seat) as seat
        from public.leads l
        cross join lateral public.lead_fee_amounts(l.id) fee
        cross join lateral public.lead_seat_priority(l.id) seat
        where l.id = any ($1) order by l.id`
      const before = (await sql.query(snapshot, [ids])).rows
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 1)
      await asOwner(sql)
      expect((await sql.query(snapshot, [ids])).rows).toEqual(before)
    })
  })
})

describe("bringing up streams", () => {
  test("every class but FORM 4 moves up with 0 seats; a clashing label takes the next free one; a second press adds nothing", async () => {
    const year = await twoYearsWithSchedules()
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const std7 = await open(sql, year, "STD 7", "A", "Mixed", 30)
      const form1Boys = await open(sql, year, "FORM 1", "B", "Boys", 30)
      const form4 = await open(sql, year, "FORM 4", "A", "Mixed", 5)
      // The year after already has a FORM 1 A.
      await open(sql, year + 1, "FORM 1", "A", "Mixed", 40)
      const up = await sql.query<{ r: Stream[] }>("select public.bring_up_streams($1, $2) as r", [year + 1, [std7.id, form1Boys.id, form4.id]])
      expect(up.rows[0].r.map((s) => `${s.label}:${s.takes}:${s.seats}`)).toEqual(["B:Mixed:0", "B:Boys:0"])
      const again = await sql.query<{ r: Stream[] }>("select public.bring_up_streams($1, $2) as r", [year + 1, [std7.id, form1Boys.id]])
      expect(again.rows[0].r).toEqual([])
    })
  })
})
