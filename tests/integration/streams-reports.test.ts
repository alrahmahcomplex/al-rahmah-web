import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { actAsStaff, inRolledBackTransaction } from "../support/db"
import { MANAGER } from "../support/fixtures"
import { asOwner, holder, named, open, refusal, streamYears } from "../support/streams"

// Streams, slice 5c (#449): Reports' seats by stream. Counts only, for staff
// who may view payments.

const yearAndClasses = streamYears()

type Figures = {
  classes: {
    class_name: string
    streams: { label: string; seats: number; full: number; first_instalment: number; deposit: number; free: number }[]
    full: number
    first_instalment: number
    deposit: number
    waiting: number
  }[]
}

describe("year_seat_figures", () => {
  test("counts each stream's children by Seat priority and its free seats, who waits, and a class with no streams by its holders", async () => {
    const { year, classes: [withStreams, without] } = await yearAndClasses(2)
    // Three Deposit holders where only two seats exist, and one in a class with no streams.
    for (const days of [9, 8, 7]) await holder(year, withStreams, "Girl", days)
    await holder(year, without, "Boy", 6)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, withStreams, "A", "Mixed", 2)
      const { rows } = await sql.query<{ f: Figures }>("select public.year_seat_figures($1) as f", [year])
      const byClass = Object.fromEntries(rows[0].f.classes.map((entry) => [entry.class_name, entry]))
      expect(byClass[withStreams]).toMatchObject({
        streams: [{ label: "A", seats: 2, full: 0, first_instalment: 0, deposit: 2, free: 0 }],
        deposit: 3,
        waiting: 1,
      })
      expect(byClass[without]).toMatchObject({ streams: [], deposit: 1, waiting: 0 })
    })
  })

  test("needs payments.view", async () => {
    const { year } = await yearAndClasses(1)
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await asOwner(sql)
      const { rows } = await sql.query<{ id: string }>(
        `select s.id from public.staff_members s join public.roles r on r.id = s.role_id
         where s.active and not ('payments.view' = any (r.permissions)) and r.id <> public.super_admin_role_id() limit 1`,
      )
      if (rows[0]) {
        await actAsStaff(sql, rows[0].id)
        expect(await refusal(sql, "select public.year_seat_figures($1)", [year])).toBe("not_permitted")
      }
      await asOwner(sql)
      await actAsStaff(sql, MANAGER.id)
      expect(await refusal(sql, "select public.year_seat_figures($1)", [year])).toBe("no refusal")
    })
  })
})
