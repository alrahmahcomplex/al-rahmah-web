import { randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { saveFeeAmounts } from "@/lib/services/fees"

import { actAsStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { claimFeeYear, FEE_YEARS } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"
import { AMOUNTS, asOwner, holder, named, open, placements, refusal, streamYears } from "../support/streams"

// An optional label and deleting an empty stream (owner 2026-11-26,
// prototype 7p183225JMd529T29EHJBp v1): "no label" counts as a label in the
// label rule, and delete_stream removes a stream nobody is placed in.

const yearAndClasses = streamYears()

type Row = { id: string; label: string | null; position: number }

async function streamsOf(sql: Client, year: number, className: string): Promise<Row[]> {
  const { rows } = await sql.query<Row>("select id, label, position from public.streams where enrollment_year = $1 and class_name = $2 order by position", [
    year,
    className,
  ])
  return rows
}

/** Two years in a row, each with a schedule: the year streams come up from, and the next. */
async function twoYearsWithSchedules(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = await claimFeeYear({
      first: FEE_YEARS.first,
      last: FEE_YEARS.last - 1,
    })
    const next = await claimFeeYear({
      first: first.year + 1,
      last: first.year + 1,
    }).catch(() => null)
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

async function nextLabel(sql: Client, year: number, className: string, takes: string): Promise<string> {
  const { rows } = await sql.query<{ l: string }>("select public.next_stream_label($1, $2, $3) as l", [year, className, takes])
  return rows[0].l
}

describe("an optional label", () => {
  test("a class's first stream needs no label; a second one that overlaps it needs one, and B is suggested", async () => {
    const {
      year,
      classes: [c],
    } = await yearAndClasses(1)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const first = await open(sql, year, c, "  ", "Mixed", 5)
      expect(first.label).toBeNull()
      expect(await refusal(sql, "select public.open_stream($1, $2, '', 'Mixed', 5, $3)", [year, c, randomUUID()])).toBe("label_taken")
      expect(await refusal(sql, "select public.open_stream($1, $2, null, 'Girls', 5, $3)", [year, c, randomUUID()])).toBe("label_taken")
      await asOwner(sql)
      expect(await nextLabel(sql, year, c, "Mixed")).toBe("B")
      await actAsStaff(sql, MANAGER.id)
      const second = await open(sql, year, c, "B", "Mixed", 5)
      expect(second).toMatchObject({ label: "B", position: 2 })
    })
  })

  test("a boys stream and a girls stream may both go without a label; a mixed one next to them may not", async () => {
    const {
      year,
      classes: [c],
    } = await yearAndClasses(1)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "", "Boys", 5)
      const girls = await open(sql, year, c, "", "Girls", 5)
      expect(girls.label).toBeNull()
      expect(await refusal(sql, "select public.open_stream($1, $2, '', 'Mixed', 5, $3)", [year, c, randomUUID()])).toBe("label_taken")
      await asOwner(sql)
      expect(await nextLabel(sql, year, c, "Boys")).toBe("B")
      expect(await nextLabel(sql, year, c, "Mixed")).toBe("B")
    })
  })

  test("change_stream empties a label only where no stream it overlaps already has none, also for the stream it opens", async () => {
    const {
      year,
      classes: [c],
    } = await yearAndClasses(1)
    const girl = await holder(year, c, "Girl", 9)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "A", "Mixed", 5)
      const b = await open(sql, year, c, "B", "Mixed", 5)
      // A loses its label; B then can't.
      await sql.query("select public.change_stream($1, '', 5, 'Mixed')", [a.id])
      expect(await refusal(sql, "select public.change_stream($1, ' ', 5, 'Mixed')", [b.id])).toBe("label_taken")
      // A made Boys opens a girls stream with no label: the two don't overlap.
      await sql.query("select public.change_stream($1, 'B2', 5, 'Mixed')", [b.id])
      await sql.query("select public.change_stream($1, '', 5, 'Boys', 'Girls', '', 1, $2)", [a.id, randomUUID()])
      await asOwner(sql)
      const { rows } = await sql.query<{ label: string | null; takes: string }>(
        "select label, takes from public.streams where enrollment_year = $1 and class_name = $2 order by position",
        [year, c],
      )
      expect(rows).toEqual([
        { label: null, takes: "Boys" },
        { label: "B2", takes: "Mixed" },
        { label: null, takes: "Girls" },
      ])
      // B2 comes before the new girls stream, so the girl moves there.
      expect(await placements(sql, [girl])).toEqual({ [girl]: "B2" })
    })
  })

  test("bring_up_streams keeps no label, unless the class already has a stream with none that it overlaps", async () => {
    const year = await twoYearsWithSchedules()
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const std2 = await open(sql, year, "STD 2", "", "Mixed", 5)
      const std3 = await open(sql, year, "STD 3", "", "Mixed", 5)
      // STD 4 of the next year already has a stream with no label.
      await open(sql, year + 1, "STD 4", "", "Mixed", 5)
      const { rows } = await sql.query<{
        b: { class_name: string; label: string | null }[]
      }>("select public.bring_up_streams($1, $2) as b", [year + 1, [std2.id, std3.id]])
      expect(rows[0].b.map((s) => [s.class_name, s.label])).toEqual([
        ["STD 3", null],
        ["STD 4", "B"],
      ])
    })
  })
})

describe("delete_stream", () => {
  test("refuses a stream with a child in it, and deletes an empty one: the streams after it move up", async () => {
    const {
      year,
      classes: [c],
    } = await yearAndClasses(1)
    const child = await holder(year, c, "Boy", 9)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "", "Mixed", 1)
      const b = await open(sql, year, c, "B", "Mixed", 5)
      const cc = await open(sql, year, c, "C", "Mixed", 5)
      expect(await refusal(sql, "select public.delete_stream($1)", [a.id])).toBe("not_empty")

      const { rows } = await sql.query<{ d: { id: string; label: string } }>("select public.delete_stream($1) as d", [b.id])
      expect(rows[0].d).toMatchObject({ id: b.id, label: "B" })
      await asOwner(sql)
      expect(await streamsOf(sql, year, c)).toEqual([
        { id: a.id, label: null, position: 1 },
        { id: cc.id, label: "C", position: 2 },
      ])
      const { rows: sits } = await sql.query<{ stream_id: string }>("select stream_id from public.seat_placements where lead_id = $1", [child])
      expect(sits[0].stream_id).toBe(a.id)

      // The audit log keeps its last row, so a child's history can name it.
      const { rows: logged } = await sql.query<{
        action: string
        actor_staff_id: string
      }>("select action, actor_staff_id from public.audit_log where table_name = 'streams' and row_id = $1 and action = 'delete'", [b.id])
      expect(logged).toEqual([{ action: "delete", actor_staff_id: MANAGER.id }])
      await actAsStaff(sql, MANAGER.id)
      const { rows: names } = await sql.query<{ n: unknown }>("select public.deleted_stream_names($1) as n", [[b.id, a.id]])
      expect(names[0].n).toEqual([{ id: b.id, class_name: c, label: "B", takes: "Mixed" }])

      // Deleted twice: gone.
      expect(await refusal(sql, "select public.delete_stream($1)", [b.id])).toBe("not_found")
    })
  })

  test("a stream that answered a request, or was brought up from, still deletes", async () => {
    const {
      year,
      classes: [c],
    } = await yearAndClasses(1)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "A", "Mixed", 5)
      await asOwner(sql)
      const later = await sql.query<{ id: string }>(
        "insert into public.streams (enrollment_year, class_name, label, takes, seats, position, brought_up_from) values ($1, $2, 'Q', 'Mixed', 0, 50, $3) returning id",
        [year, c, a.id],
      )
      await sql.query(
        "insert into public.stream_requests (enrollment_year, class_name, requested_by, resolved_at, resolved_by_stream_id) values ($1, $2, $3, now(), $4)",
        [year, c, MANAGER.id, a.id],
      )
      await actAsStaff(sql, MANAGER.id)
      await sql.query("select public.delete_stream($1)", [a.id])
      await asOwner(sql)
      const { rows } = await sql.query<{
        brought_up_from: string | null
        position: number
      }>("select brought_up_from, position from public.streams where id = $1", [later.rows[0].id])
      expect(rows[0]).toEqual({ brought_up_from: null, position: 49 })
      const { rows: requests } = await sql.query<{ n: number }>("select count(*)::int as n from public.stream_requests where resolved_by_stream_id = $1", [
        a.id,
      ])
      expect(requests[0].n).toBe(0)
    })
  })

  test("deleting a class's last stream lets its waiting children go, with the reason", async () => {
    const {
      year,
      classes: [c],
    } = await yearAndClasses(1)
    const waiting = await holder(year, c, "Girl", 9)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const boys = await open(sql, year, c, "", "Boys", 5)
      await asOwner(sql)
      const before = await sql.query<{ waiting_class: string | null }>("select waiting_class from public.seat_placements where lead_id = $1", [waiting])
      expect(before.rows[0].waiting_class).toBe(c)
      await actAsStaff(sql, MANAGER.id)
      await sql.query("select public.delete_stream($1)", [boys.id])
      await asOwner(sql)
      const after = await sql.query<{
        waiting_class: string | null
        cause: string
      }>("select waiting_class, cause from public.seat_placements where lead_id = $1", [waiting])
      expect(after.rows[0]).toEqual({
        waiting_class: null,
        cause: "stream_deleted",
      })
    })
  })

  test("only staff who may manage academic years delete a stream; a plain delete is still refused", async () => {
    const {
      year,
      classes: [c],
    } = await yearAndClasses(1)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "", "Mixed", 5)
      await asOwner(sql)
      expect(await refusal(sql, "delete from public.streams where id = $1", [a.id])).toBe("delete_refused")
      await actAsStaff(sql, ADMISSIONS.id)
      expect(await refusal(sql, "select public.delete_stream($1)", [a.id])).toBe("not_permitted")
    })
  })
})
