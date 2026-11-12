import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { unreadableValue } from "@/components/kit/dates"
import { tanzaniaToday } from "@/lib/school-calendar"
import { recordFollowUp, scheduleFollowUp } from "@/lib/services/follow-ups"
import { createLead } from "@/lib/services/leads"

import { inRolledBackTransaction, signedIn } from "../support/db"
import { ADMISSIONS } from "../support/fixtures"

// The kit's date parts (#358) post the typed text behind a prefix while it
// cannot be read, so a form that skips validation reaches the server's
// refusal instead of saving no date. Real actions must refuse that value:
// scheduling a follow-up (a date) and recording a contact (a date and time).

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// What the kit posts for text it cannot read, including text that would be a
// date without the prefix: the prefix alone must make it unreadable.
const POSTED = ["31/02/2026", "2026-13-01", "tomorrow", "12/11/20", today, `${today}T09:30`, "12/11/2026T25:00"].map(unreadableValue)

async function newLead(): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Kit Date Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

const rowsOf = (table: "follow_ups" | "follow_up_records", leadId: string) =>
  inRolledBackTransaction(async (sql) => (await sql.query(`select id from public.${table} where lead_id = $1`, [leadId])).rows)

describe("an unreadable date posted by a kit date part", () => {
  test("is refused when scheduling a follow-up, and nothing is saved", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await newLead()
    for (const dueOn of POSTED) {
      expect(await scheduleFollowUp(staff, lead, { dueOn }), dueOn).toEqual({ ok: false, error: { kind: "invalid", field: "due_on" } })
    }
    expect(await rowsOf("follow_ups", lead)).toEqual([])
  })

  test("is refused as a contact's date and time, and nothing is saved", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await newLead()
    for (const contactedAt of POSTED) {
      const result = await recordFollowUp(staff, lead, {
        followUpId: null,
        comment: "Spoke with the mother.",
        method: "Phone call",
        contactedBy: ADMISSIONS.id,
        contactedAt,
        outcome: { kind: "next_date", dueOn: today },
      })
      // The service names the next date as the field when there is one; the refusal is what matters.
      expect(result, contactedAt).toEqual({ ok: false, error: { kind: "invalid", field: expect.any(String) } })
    }
    expect(await rowsOf("follow_up_records", lead)).toEqual([])
  })
})
