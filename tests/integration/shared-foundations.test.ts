import { randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { anonClient, createThrowawayStaff, signedIn } from "../support/db"
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

  test("assert_lead_open refuses a closed lead as lead_closed and passes an open one", async () => {
    const staff = await signedIn(ACCOUNTANT)
    expect((await staff.rpc("assert_lead_open", { lead_id: OPEN })).error).toBeNull()
    for (const id of [ARCHIVED, DECLINED]) {
      const { error } = await staff.rpc("assert_lead_open", { lead_id: id })
      expect(error?.message).toBe("lead_closed")
    }
  })

  test("anon may call neither", async () => {
    const anon = anonClient()
    for (const fn of ["lead_is_closed", "assert_lead_open"]) {
      const { error } = await anon.rpc(fn, { lead_id: ARCHIVED })
      expect(error?.code).toBe("42501")
    }
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
