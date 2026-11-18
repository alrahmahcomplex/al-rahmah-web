import { randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { actAsStaff, inRolledBackTransaction } from "../support/db"
import { ACCOUNTANT, ADMISSIONS } from "../support/fixtures"
import { asOwner, child, holder, named, open, placements, refusal, streamYears, today } from "../support/streams"

// Streams, slice 5b (#449): the applicant page's reads once streams are on.
// What a Boy or girl correction would do to a placed child's seat, and three
// rules Record payment leans on: a Pre-Form One fee is never refused, a
// retried payment is not refused, and the seat outlook needs both leads.view
// and payments.view.

const yearAndClasses = streamYears()

type GenderOutlook = { placed: { label: string } | null; moves: boolean; would_take: { label: string } | null }

async function genderOutlook(sql: Client, leadId: string, gender: "Boy" | "Girl"): Promise<GenderOutlook> {
  await asOwner(sql)
  await actAsStaff(sql, ADMISSIONS.id)
  try {
    return (await sql.query<{ o: GenderOutlook }>("select public.lead_gender_outlook($1, $2) as o", [leadId, gender])).rows[0].o
  } finally {
    await asOwner(sql)
  }
}

async function pay(sql: Client, leadId: string, amount: number, requestId = randomUUID()) {
  await asOwner(sql)
  await actAsStaff(sql, ACCOUNTANT.id)
  try {
    await sql.query("select public.record_school_fee_payment($1, 'initial_deposit', $2, $3, $4)", [leadId, amount, today, requestId])
  } finally {
    await asOwner(sql)
  }
}

// The refusal a payment meets, or "no refusal"; it is rolled back either way.
async function record(sql: Client, leadId: string, type: string, amount: number, requestId = randomUUID()): Promise<string> {
  await asOwner(sql)
  await actAsStaff(sql, ACCOUNTANT.id)
  try {
    return await refusal(sql, "select public.record_school_fee_payment($1, $2, $3, $4, $5)", [leadId, type, amount, today, requestId])
  } finally {
    await asOwner(sql)
  }
}

describe("what a Boy or girl correction does to a seat", () => {
  test("a placed boy turned girl moves to the first girls' stream with room, or would wait; in a Mixed stream nothing moves", async () => {
    const { year, classes: [split, mixed] } = await yearAndClasses(2)
    const boy = await holder(year, split, "Boy", 5)
    const other = await holder(year, mixed, "Boy", 5)
    const girl = await child(year, split, "Girl")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, split, "A", "Girls", 1)
      await open(sql, year, split, "B", "Boys", 1)
      await open(sql, year, mixed, "A", "Mixed", 1)
      expect(await placements(sql, [boy, other])).toEqual({ [boy]: "B", [other]: "A" })

      expect(await genderOutlook(sql, boy, "Girl")).toEqual({ placed: expect.objectContaining({ label: "B" }), moves: true, would_take: expect.objectContaining({ label: "A" }) })
      expect(await genderOutlook(sql, boy, "Boy")).toMatchObject({ moves: false, would_take: null })
      expect(await genderOutlook(sql, other, "Girl")).toMatchObject({ placed: { label: "A" }, moves: false, would_take: null })

      // FORM 1 A (Girls) taken by a girl already: he would wait.
      await pay(sql, girl, 300_000)
      expect(await placements(sql, [girl])).toEqual({ [girl]: "A" })
      expect(await genderOutlook(sql, boy, "Girl")).toMatchObject({ moves: true, would_take: null })
    })
  })

  test("before streams are on it reads no seat, and it needs leads.edit", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const id = await holder(year, c, "Boy", 5)
    await inRolledBackTransaction(async (sql) => {
      expect(await genderOutlook(sql, id, "Girl")).toEqual({ placed: null, moves: false, would_take: null })
      // The Accountant may view leads but not edit them.
      await actAsStaff(sql, ACCOUNTANT.id)
      expect(await refusal(sql, "select public.lead_gender_outlook($1, 'Girl')", [id])).toBe("forbidden")
    })
  })
})

describe("Record payment once streams are on", () => {
  test("a Pre-Form One fee is never refused while no stream can take the child", async () => {
    const { year, classes: [form1] } = await yearAndClasses(1, ["FORM 1"])
    const id = await child(year, form1, "Boy")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, form1, "A", "Girls", 1)
      await asOwner(sql)
      await actAsStaff(sql, ADMISSIONS.id)
      await sql.query("select public.set_pre_form_one($1, true)", [id])
      expect(await record(sql, id, "initial_deposit", 300_000)).toBe("no_class")
      expect(await record(sql, id, "pre_form_one_fee", 450_000)).toBe("no refusal")
    })
  })

  test("a payment retried with the same request id is not refused, though it took the last seat", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const id = await child(year, c, "Girl")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await open(sql, year, c, "A", "Mixed", 1)
      const requestId = randomUUID()
      await pay(sql, id, 300_000, requestId)
      expect(await placements(sql, [id])).toEqual({ [id]: "A" })
      expect(await record(sql, id, "initial_deposit", 300_000, requestId)).toBe("no refusal")
      const { rows } = await sql.query<{ n: string }>("select count(*) as n from public.school_fee_payments where lead_id = $1", [id])
      expect(Number(rows[0].n)).toBe(1)
    })
  })

  test("the seat outlook refuses a caller with leads.view or payments.view but not both", async () => {
    const { year, classes: [c] } = await yearAndClasses(1)
    const id = await child(year, c, "Boy")
    await inRolledBackTransaction(async (sql) => {
      await named(sql)
      await asOwner(sql)
      for (const [has, lacks] of [
        ["leads.view", "payments.view"],
        ["payments.view", "leads.view"],
      ]) {
        // Admissions Staff, for this rolled-back transaction only, on a role
        // made here holding one of the two.
        const { rows } = await sql.query<{ id: string }>("insert into public.roles (name, permissions) values ($1, array[$2]) returning id", [
          `Only ${has} ${randomUUID().slice(0, 6)}`,
          has,
        ])
        await sql.query("update public.staff_members set role_id = $1 where id = $2", [rows[0].id, ADMISSIONS.id])
        await actAsStaff(sql, ADMISSIONS.id)
        expect(await refusal(sql, "select public.lead_seat_outlook($1)", [id]), `holding ${has}, lacking ${lacks}`).toBe("forbidden")
        await asOwner(sql)
      }
    })
  })
})
