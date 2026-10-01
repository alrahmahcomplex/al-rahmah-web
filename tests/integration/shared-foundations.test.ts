import { randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { anonClient, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The functions Wave 0 (#122) lays down for slices 3–10 to build on, against
// local Supabase. The seeded leads: ADMSN-90002 is open and Visited,
// ADMSN-90005 Archived, ADMSN-90006 Declined.
const OPEN = "1ead0000-0000-4000-8000-000000000002"
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const DECLINED = "1ead0000-0000-4000-8000-000000000006"

describe("the closure guard", () => {
  test("lead_is_closed is true for a Declined lead and one with a closure mark, and false otherwise", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const [id, closed] of [
      [OPEN, false],
      [ARCHIVED, true],
      [DECLINED, true],
      [randomUUID(), false],
    ] as const) {
      const { data, error } = await staff.rpc("lead_is_closed", { lead_id: id })
      expect(error).toBeNull()
      expect(data).toBe(closed)
    }
  })

  test("lead_is_closed is forbidden to staff who may not view leads", async () => {
    const outsider = await signedIn(await createThrowawayStaff(["staff.administer"]))
    expect((await outsider.rpc("lead_is_closed", { lead_id: ARCHIVED })).error?.message).toBe("forbidden")
  })

  test("assert_lead_open refuses a closed lead as lead_closed and passes an open one", async () => {
    // As the database owner, the role every write function runs as.
    const answers = await inRolledBackTransaction(async (sql) => {
      const out: Record<string, string | null> = {}
      for (const id of [OPEN, ARCHIVED, DECLINED]) {
        await sql.query("savepoint each")
        try {
          await sql.query("select public.assert_lead_open($1)", [id])
          out[id] = null
        } catch (error) {
          out[id] = (error as Error).message
          await sql.query("rollback to savepoint each")
        }
      }
      return out
    })
    expect(answers).toEqual({ [OPEN]: null, [ARCHIVED]: "lead_closed", [DECLINED]: "lead_closed" })
  })

  test("assert_lead_open is for write functions only: no signed-in caller or anon may call it", async () => {
    for (const client of [await signedIn(ADMISSIONS), await signedIn(MANAGER), anonClient()]) {
      const { error } = await client.rpc("assert_lead_open", { lead_id: ARCHIVED })
      expect(error?.code).toBe("42501")
    }
  })

  test("anon may not call lead_is_closed", async () => {
    const { error } = await anonClient().rpc("lead_is_closed", { lead_id: ARCHIVED })
    expect(error?.code).toBe("42501")
  })

  test("a write function still refuses a closed lead for a writer who may not view leads", async () => {
    const writer = await signedIn(await createThrowawayStaff(["leads.edit"]))
    const { error } = await writer.rpc("update_lead_details", { lead_id: ARCHIVED, changes: { class_name: "STD 1" } })
    expect(error?.message).toBe("lead_closed")
  })
})

describe("the expected interview amount stand-in", () => {
  test("is the full TZS 50,000 with no discount, for anyone who may view leads", async () => {
    for (const person of [ADMISSIONS, ACCOUNTANT, MANAGER]) {
      const { data, error } = await (await signedIn(person)).rpc("expected_interview_amount", { lead_id: OPEN })
      expect(error).toBeNull()
      expect(data).toEqual({ amount: 50000, discount_applied: false })
    }
  })

  test("is refused as forbidden without leads.view, as not_found for a missing lead, and to anon", async () => {
    const outsider = await signedIn(await createThrowawayStaff(["staff.administer"]))
    expect((await outsider.rpc("expected_interview_amount", { lead_id: OPEN })).error?.message).toBe("forbidden")

    const staff = await signedIn(ADMISSIONS)
    expect((await staff.rpc("expected_interview_amount", { lead_id: randomUUID() })).error?.message).toBe("not_found")

    expect((await anonClient().rpc("expected_interview_amount", { lead_id: OPEN })).error?.code).toBe("42501")
  })
})
