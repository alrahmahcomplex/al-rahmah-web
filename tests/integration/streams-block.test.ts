import { randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { decideDiscount, requestDiscount } from "@/lib/services/discounts"

import { actAsStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"
import { AMOUNTS, asOwner, child, holder, legacy, named, open, placements, refusal, streamYears, today } from "../support/streams"

// Streams, slice 4b (#449): the school-fee block, stream requests, the reads
// and the Fee schedule's seats once streams are on. Each test opens its
// streams inside its own rolled-back transaction; payments made there run
// record_school_fee_payment as the Accountant.

const yearAndClasses = streamYears()
// A year whose minimum deposit is above 40% of the nursery fee: there the
// First instalment, not the deposit, is the first Seat priority (Q33).
const highDepositYear = streamYears({ ...AMOUNTS, minimumDeposit: 1_000_000 })

async function pay(sql: Client, leadId: string, amount: number | null, type = "initial_deposit", paidOn = today) {
  await asOwner(sql)
  await actAsStaff(sql, ACCOUNTANT.id)
  try {
    await sql.query("select public.record_school_fee_payment($1, $2, $3, $4, $5)", [leadId, type, amount, paidOn, randomUUID()])
  } finally {
    await asOwner(sql)
  }
}

async function payRefusal(sql: Client, leadId: string, amount: number | null, type = "initial_deposit"): Promise<string> {
  await asOwner(sql)
  await actAsStaff(sql, ACCOUNTANT.id)
  try {
    return await refusal(sql, "select public.record_school_fee_payment($1, $2, $3, $4, $5)", [leadId, type, amount, today, randomUUID()])
  } finally {
    await asOwner(sql)
  }
}

type Outlook = {
  blocked: boolean
  books_at: number | null
  books_kind: string | null
  placed: { label: string } | null
  would_take: { label: string } | null
  waiting: boolean
  request: { id: string; resolved_at: string | null } | null
}

async function outlook(sql: Client, leadId: string): Promise<Outlook> {
  await asOwner(sql)
  await actAsStaff(sql, MANAGER.id)
  try {
    return (await sql.query<{ o: Outlook }>("select public.lead_seat_outlook($1) as o", [leadId])).rows[0].o
  } finally {
    await asOwner(sql)
  }
}

async function paidTotal(sql: Client, leadId: string): Promise<number> {
  const { rows } = await sql.query<{ total: string }>("select coalesce(sum(amount), 0) as total from public.school_fee_payments where lead_id = $1", [leadId])
  return Number(rows[0].total)
}

describe("while the seat mode is legacy", () => {
  test("nothing is refused: no block, no requests, and the Fee schedule still saves seats", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const id = await child(year, c, "Boy")
    await inRolledBackTransaction(async (sql) => {
      // The mode before the activation migration, for this transaction only.
      await legacy(sql)
      await asOwner(sql)
      await actAsStaff(sql, ADMISSIONS.id)
      expect(await refusal(sql, "select public.request_stream($1, null, null, null)", [id])).toBe("seat_mode_legacy")
      await asOwner(sql)
      await pay(sql, id, 300_000)
      expect(await paidTotal(sql, id)).toBe(300_000)
      await actAsStaff(sql, MANAGER.id)
      const seats = JSON.stringify({ seats: [{ class_name: c, day_or_boarding: "Day", seats: 30, was: null }] })
      expect(await refusal(sql, "select public.set_academic_year($1, $2::jsonb)", [year, seats])).toMatch(/^(no refusal|stale)$/)
    })
  })
})

describe("the school-fee block", () => {
  test("a child with no seat priority can't pay while no stream takes them, and can once one does", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const placed = await holder(year, c, "Girl", 5)
    const boy = await child(year, c, "Boy")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 1)
      expect((await outlook(sql, boy)).blocked).toBe(true)
      expect(await payRefusal(sql, boy, 300_000)).toBe("no_class")
      // The preview refuses the same way, before anyone types an amount.
      await actAsStaff(sql, ACCOUNTANT.id)
      expect(await refusal(sql, "select public.preview_school_fee_payment($1, 'initial_deposit', 300000, $2)", [boy, today])).toBe("no_class")
      await asOwner(sql)
      expect(await paidTotal(sql, boy)).toBe(0)

      await actAsStaff(sql, MANAGER.id)
      await open(sql, year, c, "B", "Boys", 1)
      expect((await outlook(sql, boy)).would_take?.label).toBe("B")
      await pay(sql, boy, 300_000)
      expect(await placements(sql, [placed, boy])).toEqual({ [placed]: "A", [boy]: "B" })
    })
  })

  test("a class with no streams is never full, and a second instalment is never refused", async () => {
    const { year, classes: [noStreams, full] } = await yearAndClasses(2)
    const free = await child(year, noStreams, "Boy")
    const paying = await holder(year, full, "Boy", 5)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, full, "A", "Boys", 1)
      await pay(sql, free, 300_000)
      expect(await paidTotal(sql, free)).toBe(300_000)
      // Already holding a seat: later payments go through.
      await pay(sql, paying, 500_000, "first_instalment")
      expect(await paidTotal(sql, paying)).toBe(800_000)
    })
  })
})

describe("a payment below the deposit (Q33 A: the Seat priority books the seat)", () => {
  test("is kept while a seat is free and books nothing; another child who pays the deposit takes the seat; the next payment is refused", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const [first, second] = [await child(year, c, "Girl"), await child(year, c, "Girl")]
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 1)
      expect(await outlook(sql, first)).toMatchObject({ blocked: false, books_at: 300_000, books_kind: "deposit", would_take: { label: "A" } })

      await pay(sql, first, 100_000)
      expect(await placements(sql, [first])).toEqual({ [first]: null })
      await pay(sql, second, 300_000)
      expect(await placements(sql, [first, second])).toEqual({ [first]: null, [second]: "A" })

      expect((await outlook(sql, first)).blocked).toBe(true)
      expect(await payRefusal(sql, first, 200_000)).toBe("no_class")
      expect(await paidTotal(sql, first)).toBe(100_000)
    })
  })

  test("on a fee whose first share is below the deposit, the first share books the seat, and is refused when none is free", async () => {
    const { year, classes: [c] } = await highDepositYear(1, ["DAY CARE", "KG 1", "KG 2"])
    const [first, second] = [await child(year, c, "Boy"), await child(year, c, "Boy")]
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 1)
      // Nursery Day: 1,100,000, so 40% is 440,000, below the 1,000,000 deposit.
      expect(await outlook(sql, first)).toMatchObject({ books_at: 440_000, books_kind: "first_share" })
      await pay(sql, first, 440_000, "first_instalment")
      expect(await placements(sql, [first])).toEqual({ [first]: "A" })
      expect(await payRefusal(sql, second, 440_000, "first_instalment")).toBe("no_class")
    })
  })

  test("a waived fee books the seat with the Fee waived payment, and is refused when no stream has room", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const [orphan, other] = [await child(year, c, "Girl"), await child(year, c, "Girl")]
    for (const id of [orphan, other]) {
      const asked = await requestDiscount(await signedIn(ADMISSIONS), id, "qualified_orphan", "Both parents died.", randomUUID())
      if (!asked.ok) throw new Error(`request failed: ${JSON.stringify(asked.error)}`)
      const decided = await decideDiscount(await signedIn(MANAGER), asked.data, { decision: "grant" })
      if (!decided.ok) throw new Error(`grant failed: ${decided.error}`)
    }
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 1)
      expect(await outlook(sql, orphan)).toMatchObject({ books_at: 0, books_kind: "waived" })
      await pay(sql, orphan, null, "fee_waived")
      expect(await placements(sql, [orphan])).toEqual({ [orphan]: "A" })
      expect(await payRefusal(sql, other, null, "fee_waived")).toBe("no_class")
    })
  })
})

describe("stream requests", () => {
  test("a request for a child: refused while a stream can take them, made once, and resolved when a fitting stream opens", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const placed = await holder(year, c, "Girl", 5)
    const boy = await child(year, c, "Boy")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 2)
      await asOwner(sql)
      await actAsStaff(sql, ADMISSIONS.id)
      expect(await refusal(sql, "select public.request_stream($1, null, null, null)", [boy])).toBe("not_full")

      await asOwner(sql)
      await actAsStaff(sql, MANAGER.id)
      const stream = (await sql.query("select id from public.streams where enrollment_year = $1 and class_name = $2", [year, c])).rows[0].id
      await sql.query("select public.edit_stream($1, 'A', 1)", [stream])
      await asOwner(sql)
      await actAsStaff(sql, ADMISSIONS.id)
      const made = (await sql.query("select public.request_stream($1, null, null, null) as r", [boy])).rows[0].r
      expect(made).toMatchObject({ class_name: c, need: "Boys", lead_id: boy })
      const again = (await sql.query("select public.request_stream($1, null, null, null) as r", [boy])).rows[0].r
      expect(again.id).toBe(made.id)

      await asOwner(sql)
      expect((await outlook(sql, boy)).request).toMatchObject({ id: made.id, resolved_at: null })
      await actAsStaff(sql, MANAGER.id)
      const boys = await open(sql, year, c, "B", "Boys", 1)
      await asOwner(sql)
      const { rows } = await sql.query("select resolved_at is not null as done, resolved_by_stream_id from public.stream_requests where id = $1", [made.id])
      expect(rows[0]).toEqual({ done: true, resolved_by_stream_id: boys.id })
      expect(await placements(sql, [placed])).toEqual({ [placed]: "A" })
    })
  })

  test("a child's request closes when their class is corrected before any payment", async () => {
    const { year, classes: [from, to] } = await yearAndClasses(2)
    const placed = await holder(year, from, "Boy", 5)
    const boy = await child(year, from, "Boy")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, from, "A", "Boys", 1)
      await asOwner(sql)
      await actAsStaff(sql, ADMISSIONS.id)
      const made = (await sql.query("select public.request_stream($1, null, null, null) as r", [boy])).rows[0].r
      await asOwner(sql)
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.leads set class_name = $2 where id = $1", [boy, to])
      await sql.query("select public.flush_seat_queue()")
      const { rows } = await sql.query("select resolved_at is not null as done from public.stream_requests where id = $1", [made.id])
      expect(rows[0].done).toBe(true)
      expect(await placements(sql, [placed])).toEqual({ [placed]: "A" })
    })
  })

  // What two openings leave behind when the waiting girl's row was busy: a
  // mixed stream and a boys' stream with a seat each, her seat in the mixed
  // one counted but not written, and her retry. Returns the boys' stream.
  async function openedWhileHerRowWasBusy(sql: Client, year: number, c: string, girl: string): Promise<string> {
    await asOwner(sql)
    await sql.query("select public.set_audit_actor('system')")
    await sql.query("update public.seat_placements set waiting_xid = '1'::xid8 where lead_id = $1", [girl])
    await sql.query("insert into public.streams (enrollment_year, class_name, label, takes, seats, position) values ($1, $2, 'B', 'Mixed', 1, 2)", [year, c])
    const boys = await sql.query<{ id: string }>(
      "insert into public.streams (enrollment_year, class_name, label, takes, seats, position) values ($1, $2, 'C', 'Boys', 1, 3) returning id",
      [year, c],
    )
    await sql.query("select public.queue_seat_retry($1, $2, $3)", [girl, year, c])
    return boys.rows[0].id
  }

  test("a request answered while its child's row was busy gives him no turn: paying in full, he still comes after the girl already waiting", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const seated = await holder(year, c, "Boy", 20)
    const girl = await holder(year, c, "Girl", 3)
    const boy = await child(year, c, "Boy")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Boys", 1)
      await asOwner(sql)
      await actAsStaff(sql, ADMISSIONS.id)
      const made = (await sql.query("select public.request_stream($1, null, null, null) as r", [boy])).rows[0].r
      // The boys' stream answers his request, but his row was busy too: the
      // request stays open with its own kind of retry.
      const boysStream = await openedWhileHerRowWasBusy(sql, year, c, girl)
      await sql.query("select public.queue_request_retry($1, $2, $3)", [boy, year, c])

      // Full ranks above her Deposit, and she was waiting first.
      const fee = (await sql.query<{ school_fee: number }>("select school_fee from public.lead_seat_priority($1)", [boy])).rows[0].school_fee
      await pay(sql, boy, fee, "full_payment")
      expect(await placements(sql, [seated, girl, boy])).toEqual({ [seated]: "A", [girl]: "B", [boy]: "C" })
      const { rows } = await sql.query("select resolved_at is not null as done, resolved_by_stream_id from public.stream_requests where id = $1", [made.id])
      expect(rows[0]).toEqual({ done: true, resolved_by_stream_id: boysStream })
      expect((await sql.query("select 1 from public.seat_sync_queue where lead_id = any ($1)", [[girl, boy]])).rows).toEqual([])
    })
  })

  test("a child whose only retry is a request's is left out wherever children already waiting go first", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const seated = await holder(year, c, "Boy", 20)
    const asked = await holder(year, c, "Boy", 9)
    const girl = await holder(year, c, "Girl", 3)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Boys", 1)
      await openedWhileHerRowWasBusy(sql, year, c, girl)
      // He ranks above her and has no wait recorded, only a request's retry.
      await sql.query("update public.seat_placements set waiting_since = null, waiting_xid = null, waiting_year = null, waiting_class = null where lead_id = $1", [asked])
      await sql.query("select public.queue_request_retry($1, $2, $3)", [asked, year, c])
      // A request's retry and a skipped seat write's are kept apart, one of each at most.
      await sql.query("select public.queue_request_retry($1, $2, $3)", [asked, year, c])
      await sql.query("select public.queue_seat_retry($1, $2, $3)", [girl, year, c])
      const { rows } = await sql.query("select lead_id, for_request from public.seat_sync_queue where lead_id = any ($1) and retry", [[asked, girl]])
      expect(rows).toHaveLength(2)
      expect(rows).toEqual(expect.arrayContaining([{ lead_id: asked, for_request: true }, { lead_id: girl, for_request: false }]))
      const seats = { [seated]: "A", [girl]: "B", [asked]: "C" }

      // The first-fit read: she takes the mixed seat and he the boys', so no third boy fits.
      expect((await sql.query("select public.stream_fit($1, $2, 'Boy', false, null) as fit", [year, c])).rows[0].fit).toBeNull()

      // The daily job.
      await sql.query("savepoint before_job")
      expect((await sql.query("select public.run_seat_retries() as n")).rows[0].n).toBeGreaterThanOrEqual(2)
      expect(await placements(sql, [seated, girl, asked])).toEqual(seats)
      await sql.query("rollback to savepoint before_job")

      // A stream opening while both retries are still queued.
      await actAsStaff(sql, MANAGER.id)
      await open(sql, year, c, "D", "Boys", 1)
      await asOwner(sql)
      expect(await placements(sql, [seated, girl, asked])).toEqual(seats)
    })
  })

  test("a request for a class and need, and the Seats read with its waiting children and requests", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const placed = await holder(year, c, "Boy", 6)
    const waiting = await holder(year, c, "Boy", 3)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Boys", 1)
      await asOwner(sql)
      await actAsStaff(sql, ADMISSIONS.id)
      expect(await refusal(sql, "select public.request_stream(null, $1, $2, 'Girls')", [year, c])).toBe("no refusal")
      const made = (await sql.query("select public.request_stream(null, $1, $2, 'Boys') as r", [year, c])).rows[0].r
      expect(made).toMatchObject({ need: "Boys", lead_id: null })
      const seats = (await sql.query("select public.year_streams($1) as y", [year])).rows[0].y
      const mine = seats.classes.find((k: { class_name: string }) => k.class_name === c)
      expect(mine).toMatchObject({ free_for_boy: false, free_for_girl: false, free_for_any: false })
      expect(mine.streams).toEqual([expect.objectContaining({ label: "A", takes: "Boys", seats: 1, placed: 1 })])
      expect(mine.waiting.map((w: { lead_id: string }) => w.lead_id)).toEqual([waiting])
      expect(seats.requests.filter((r: { class_name: string }) => r.class_name === c)).toEqual([
        expect.objectContaining({ id: made.id, need: "Boys", requested_by_name: ADMISSIONS.name, resolved_at: null }),
      ])
      expect(await placements(sql, [placed])).toEqual({ [placed]: "A" })
    })
  })

  test("asking needs payments.view, and leads.view too for a child", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const id = await child(year, c, "Boy")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await asOwner(sql)
      // Any active staff member whose role can't view payments.
      const { rows } = await sql.query<{ id: string }>(
        `select s.id from public.staff_members s join public.roles r on r.id = s.role_id
         where s.active and not ('payments.view' = any (r.permissions)) and r.id <> public.super_admin_role_id() limit 1`,
      )
      if (rows[0]) {
        await actAsStaff(sql, rows[0].id)
        expect(await refusal(sql, "select public.request_stream($1, null, null, null)", [id])).toBe("not_permitted")
        expect(await refusal(sql, "select public.year_streams($1)", [year])).toBe("not_permitted")
      }
    })
  })
})

describe("the Fee schedule once streams are on", () => {
  test("a seats change is refused with seats_moved; the Academic-year start still saves", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const seats = JSON.stringify({ seats: [{ class_name: c, day_or_boarding: "Day", seats: 30, was: null }] })
      expect(await refusal(sql, "select public.set_academic_year($1, $2::jsonb)", [year, seats])).toBe("seats_moved")
      expect(await refusal(sql, "select public.set_academic_year($1, '{}'::jsonb)", [year])).toBe("no refusal")
    })
  })
})
