import { describe, expect, test } from "vitest"

import { inRolledBackTransaction } from "../../support/db"

// With no working code at all, the price box range reads 0 and 0, not null,
// so the Admission form can tell "nothing gives a saving" from a failed read.
// Serial: it pauses every code in its transaction, rows other files use.

describe("the interview discount range with no working code", () => {
  test("is 0 and 0", async () => {
    const seen = await inRolledBackTransaction(async (sql) => {
      // Triggers off for this transaction only: no fees or audit rows move.
      await sql.query("set local session_replication_role = replica")
      await sql.query("update public.promo_codes set state = 'paused' where state = 'active'")
      await sql.query("update public.marketing_agents set switched_off_at = now() where switched_off_at is null")
      const { rows } = await sql.query<{ lowest: number; highest: number }>("select lowest, highest from public.interview_discount_range()")
      return rows[0]
    })
    expect(seen).toEqual({ lowest: 0, highest: 0 })
  })
})
