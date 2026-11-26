import { randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { actAsStaff, inRolledBackTransaction } from "../support/db"
import { ADMISSIONS, MANAGER } from "../support/fixtures"
import { asOwner, holder, named, open, placements, refusal, streamYears } from "../support/streams"

// Changing who a stream takes (owner 2026-11-26, prototype v4): change_stream,
// the boys and girls year_streams counts, and year_stream_children.

const yearAndClasses = streamYears()

type Changed = {
  stream: { id: string; label: string; takes: string; seats: number; placed: number }
  opened: { id: string; label: string; takes: string; seats: number; placed: number; position: number } | null
  moved: { lead_id: string; stream_id: string | null }[]
  seated_from_waiting: number
}

async function change(sql: Client, args: unknown[]): Promise<Changed> {
  const { rows } = await sql.query<{ c: Changed }>("select public.change_stream($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as c", [
    ...args,
    ...Array(10 - args.length).fill(null),
  ])
  return rows[0].c
}

async function causes(sql: Client, ids: string[]): Promise<Record<string, string>> {
  const { rows } = await sql.query<{ lead_id: string; cause: string }>("select lead_id, cause from public.seat_placements where lead_id = any ($1)", [ids])
  return Object.fromEntries(rows.map((r) => [r.lead_id, r.cause]))
}

describe("change_stream", () => {
  test("a Mixed stream made Boys keeps its boys; with no room elsewhere its girls wait, and a waiting boy takes a freed seat", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const boy = await holder(year, c, "Boy", 9)
    const girl = await holder(year, c, "Girl", 8)
    const noAnswer = await holder(year, c, undefined, 7)
    const waitingBoy = await holder(year, c, "Boy", 6)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "A", "Mixed", 3)
      expect(await refusal(sql, "select public.change_stream($1, 'A', 0, 'Boys')", [a.id])).toBe("below_placed")

      const changed = await change(sql, [a.id, "A", 3, "Boys"])
      expect(changed.stream).toMatchObject({ takes: "Boys", seats: 3, placed: 2 })
      expect(changed.opened).toBeNull()
      expect(changed.moved.toSorted((x, y) => x.lead_id.localeCompare(y.lead_id))).toEqual(
        [girl, noAnswer].toSorted().map((id) => ({ lead_id: id, stream_id: null })),
      )
      expect(changed.seated_from_waiting).toBe(1)
      await asOwner(sql)
      expect(await placements(sql, [boy, girl, noAnswer, waitingBoy])).toEqual({ [boy]: "A", [girl]: null, [noAnswer]: null, [waitingBoy]: "A" })
      // The history says why: the girls left because of the change, and the waiting boy took a place for the same reason.
      expect(await causes(sql, [girl, noAnswer, waitingBoy])).toEqual({ [girl]: "stream_takes", [noAnswer]: "stream_takes", [waitingBoy]: "stream_takes" })
      const { rows } = await sql.query<{ waiting: number }>(
        "select count(*)::int as waiting from public.seat_placements where lead_id = any ($1) and waiting_class = $2 and waiting_year = $3",
        [[girl, noAnswer], c, year],
      )
      expect(rows[0].waiting).toBe(2)
    })
  })

  test("a new stream opened in the same save takes the girls, after a girl already waiting", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const placedGirl = await holder(year, c, "Girl", 9)
    const placedBoy = await holder(year, c, "Boy", 8)
    const waitingGirl = await holder(year, c, "Girl", 7)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "A", "Mixed", 2)
      await asOwner(sql)
      expect(await placements(sql, [waitingGirl])).toEqual({ [waitingGirl]: null })
      // The waiting girl was recorded by an earlier transaction, so she keeps her turn.
      await sql.query("update public.seat_placements set waiting_xid = '1'::xid8 where lead_id = $1", [waitingGirl])
      await actAsStaff(sql, MANAGER.id)

      // One seat: the girl already waiting takes it, and the moving girl waits.
      const request = randomUUID()
      const changed = await change(sql, [a.id, "A", 2, "Boys", "Girls", "B", 1, request])
      expect(changed.opened).toMatchObject({ label: "B", takes: "Girls", seats: 1, position: 2, placed: 1 })
      expect(changed.moved).toEqual([{ lead_id: placedGirl, stream_id: null }])
      expect(changed.seated_from_waiting).toBe(1)
      await asOwner(sql)
      expect(await placements(sql, [placedGirl, placedBoy, waitingGirl])).toEqual({ [placedGirl]: null, [placedBoy]: "A", [waitingGirl]: "B" })

      // A retry of the same save hands back what it did and opens nothing more.
      await actAsStaff(sql, MANAGER.id)
      const again = await change(sql, [a.id, "A", 2, "Boys", "Girls", "B", 1, request])
      expect(again.opened?.id).toBe(changed.opened?.id)
      await asOwner(sql)
      const { rows } = await sql.query<{ n: number }>("select count(*)::int as n from public.streams where enrollment_year = $1 and class_name = $2", [year, c])
      expect(rows[0].n).toBe(2)
    })
  })

  test("raising another stream's seats in the same save gives the moving children a place there", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const boy = await holder(year, c, "Boy", 9)
    const firstGirl = await holder(year, c, "Girl", 8)
    const secondGirl = await holder(year, c, "Girl", 7)
    const thirdGirl = await holder(year, c, "Girl", 6)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "A", "Mixed", 3)
      const g = await open(sql, year, c, "G", "Girls", 1)
      await asOwner(sql)
      expect(await placements(sql, [boy, firstGirl, secondGirl, thirdGirl])).toEqual({ [boy]: "A", [firstGirl]: "A", [secondGirl]: "A", [thirdGirl]: "G" })
      await actAsStaff(sql, MANAGER.id)

      expect(await refusal(sql, "select public.change_stream($1, 'A', 3, 'Boys', null, null, null, null, $2, 0)", [a.id, g.id])).toBe("below_placed")
      expect(await refusal(sql, "select public.change_stream($1, 'A', 3, 'Boys', null, null, null, null, $2, null)", [a.id, g.id])).toBe("invalid")
      expect(await refusal(sql, "select public.change_stream($1, 'A', 3, 'Boys', null, null, null, null, $1, 9)", [a.id])).toBe("not_found")

      const changed = await change(sql, [a.id, "A", 3, "Boys", null, null, null, null, g.id, 3])
      expect(changed.moved.map((m) => m.stream_id)).toEqual([g.id, g.id])
      await asOwner(sql)
      expect(await placements(sql, [boy, firstGirl, secondGirl, thirdGirl])).toEqual({ [boy]: "A", [firstGirl]: "G", [secondGirl]: "G", [thirdGirl]: "G" })
    })
  })

  test("labels are checked against who the stream will take, for the stream and the one it opens", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const boys = await open(sql, year, c, "A", "Boys", 5)
      await open(sql, year, c, "A", "Girls", 5)
      // A Mixed A would clash with the girls' A; a Mixed B does not.
      expect(await refusal(sql, "select public.change_stream($1, 'A', 5, 'Mixed')", [boys.id])).toBe("label_taken")
      expect(await refusal(sql, "select public.change_stream($1, 'A', 5, 'Girls')", [boys.id])).toBe("label_taken")
      expect(await refusal(sql, "select public.change_stream($1, 'B', 5, 'Mixed', 'Girls', 'a', 3, gen_random_uuid())", [boys.id])).toBe("label_taken")
      expect(await change(sql, [boys.id, "B", 5, "Mixed"])).toMatchObject({ stream: { label: "B", takes: "Mixed" } })
    })
  })

  test("refuses a half-filled new stream or a new stream and a raise together", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "A", "Mixed", 5)
      const b = await open(sql, year, c, "B", "Girls", 5)
      expect(await refusal(sql, "select public.change_stream($1, 'A', 5, 'Boys', 'Girls', 'C', 3, null)", [a.id])).toBe("invalid")
      expect(await refusal(sql, "select public.change_stream($1, 'A', 5, 'Boys', 'Girls', 'C', 0, gen_random_uuid())", [a.id])).toBe("invalid")
      expect(await refusal(sql, "select public.change_stream($1, 'A', 5, 'Boys', 'Girls', 'C', 3, gen_random_uuid(), $2, 9)", [a.id, b.id])).toBe("invalid")
      expect(await refusal(sql, "select public.change_stream($1, repeat('L', 21), 5, 'Boys')", [a.id])).toBe("invalid")
    })
  })

  test("only staff who may manage academic years change a stream or read its children", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "A", "Mixed", 5)
      await asOwner(sql)
      await actAsStaff(sql, ADMISSIONS.id)
      expect(await refusal(sql, "select public.change_stream($1, 'A', 5, 'Boys')", [a.id])).toBe("not_permitted")
      expect(await refusal(sql, "select public.year_stream_children($1)", [year])).toBe("not_permitted")
    })
  })
})

describe("the reads", () => {
  test("year_streams counts the boys and girls in each stream; year_stream_children lists them with their rank", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const boy = await holder(year, c, "Boy", 9)
    const girl = await holder(year, c, "Girl", 8)
    const noAnswer = await holder(year, c, undefined, 7)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      const a = await open(sql, year, c, "A", "Mixed", 5)
      const { rows } = await sql.query<{ y: { classes: { class_name: string; streams: { boys: number; girls: number; placed: number }[] }[] } }>(
        "select public.year_streams($1) as y",
        [year],
      )
      expect(rows[0].y.classes.find((each) => each.class_name === c)?.streams[0]).toMatchObject({ placed: 3, boys: 1, girls: 1 })

      const children = await sql.query<{ k: { lead_id: string; gender: string | null; stream_id: string; class_name: string; rank: number }[] }>(
        "select public.year_stream_children($1) as k",
        [year],
      )
      const mine = children.rows[0].k.filter((k) => k.class_name === c)
      expect(mine.map((k) => [k.lead_id, k.gender, k.stream_id, k.rank])).toEqual([
        [boy, "Boy", a.id, 1],
        [girl, "Girl", a.id, 2],
        [noAnswer, null, a.id, 3],
      ])
    })
  })
})
