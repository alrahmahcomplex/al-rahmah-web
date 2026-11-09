import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"

import { asSystem, signedIn, unusedAdmissionNumber } from "./db"
import { ACCOUNTANT, ADMISSIONS } from "./fixtures"

// Fixtures for discount amounts and Promo codes: leads carrying a code, and
// an interview fee marked Paid through the Accountant's own path, so the
// locked amount is the one a family really paid. Invented names and +255 8xx
// numbers only, clear of the other test files' 5xx, 6xx and 7xx numbers.

export function discountPhone(): string {
  return `+2558${String(randomInt(10_000_000, 100_000_000))}`
}

// A letters-and-digits code no agent or Promo code is likely to hold.
export function freshCode(prefix = "T"): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase()}`
}

// A Visited lead carrying `code`, on a contact of its own, written as the
// system.
export async function leadWithCode(code: string | null, name = `Punguzo ${randomUUID().slice(0, 8)}`): Promise<string> {
  const admissionNumber = await unusedAdmissionNumber()
  return asSystem(async (sql) => {
    const contact = await sql.query<{ id: string }>(
      `insert into public.guardian_contacts (full_name, relationship, phone, origin)
       values ('Mzazi Punguzo', 'Mother', $1, 'front_desk') returning id`,
      [discountPhone()],
    )
    const lead = await sql.query<{ id: string }>(
      `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, visit_date,
           guardian_contact_id, referral_code)
       values ($1, $2, 'STD 3', 2027, 'Day', 'Visited', '2026-09-01', $3, $4) returning id`,
      [admissionNumber, name, contact.rows[0].id, code],
    )
    return lead.rows[0].id
  })
}

// Registers the lead for interview and marks the fee Paid as the Accountant.
// Returns the amount the payment locked.
export async function payInterview(leadId: string): Promise<number> {
  const registered = await (await signedIn(ADMISSIONS)).rpc("register_for_interview", { lead_id: leadId })
  if (registered.error) throw new Error(`registration failed: ${registered.error.message}`)
  const interviewId = (registered.data as { interview_id: string }).interview_id
  const paid = await (await signedIn(ACCOUNTANT)).rpc("set_interview_fee_status", { interview_id: interviewId, fee_status: "Paid" })
  if (paid.error) throw new Error(`payment failed: ${paid.error.message}`)
  return (paid.data as { locked_amount: number }).locked_amount
}

export async function lockedAmount(leadId: string): Promise<number | null> {
  return asSystem(async (sql) => {
    const { rows } = await sql.query<{ locked_amount: number | null }>(
      "select locked_amount from public.interviews where lead = $1 order by registered_at desc limit 1",
      [leadId],
    )
    return rows[0]?.locked_amount ?? null
  })
}

// What the lead's interview costs now, read as the database owner.
export async function expectedFee(sql: Client, leadId: string): Promise<number> {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })])
  const { rows } = await sql.query<{ amount: number }>("select amount from public.expected_interview_amount($1)", [leadId])
  return rows[0].amount
}

// Acts in `sql`'s transaction as a signed-in staff member, as PostgREST sets
// the session for a request.
export async function actAs(sql: Client, staffId: string): Promise<void> {
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [staffId])
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
}
