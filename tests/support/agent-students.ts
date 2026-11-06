import { randomInt, randomUUID } from "node:crypto"

import { asSystem, secretClient, signedIn, unusedAdmissionNumber } from "./db"
import { ADMISSIONS, MANAGER } from "./fixtures"

// Fixtures for the students using an agent's Discount code (#195): an agent
// of the test's own with a login, and leads carrying their code. Invented
// names, +255 6xx numbers and example.test emails only.

export type StudentsAgent = { id: string; code: string; fullName: string; email: string; password: string }

// An Approved agent the Manager creates, with a confirmed login.
export async function agentWithLogin(): Promise<StudentsAgent> {
  const suffix = randomUUID().slice(0, 8)
  const fullName = `Rehema Students ${suffix}`
  const email = `students-${suffix}@example.test`
  const { data, error } = await (await signedIn(MANAGER)).rpc("create_marketing_agent", {
    full_name: fullName,
    // A leading 7 keeps it clear of the seeded 700 000 numbers.
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
    whatsapp: "",
    email,
    code: "",
  })
  const row = data as { outcome: string; agent: { id: string; code: string } } | null
  if (error || row?.outcome !== "created") throw new Error(`could not create: ${JSON.stringify(error ?? row)}`)
  const password = "fixture-password"
  const login = await secretClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (login.error) throw login.error
  return { id: row.agent.id, code: row.agent.code, fullName, email, password }
}

export type StudentLead = {
  name: string
  code: string
  status?: "Applied" | "Visited" | "Interviewed" | "Enrolled" | "Declined"
  closure?: "Inactive" | "Archived"
  createdAt?: string
}

// A lead carrying `code`, with a family of its own, written as the system. A
// Declined lead has the reason "Did not pass interview" and a staff-only
// explanation; a closure mark has a reason too.
export async function studentLead(spec: StudentLead): Promise<string> {
  const admissionNumber = await unusedAdmissionNumber()
  return asSystem(async (sql) => {
    const contact = await sql.query<{ id: string }>(
      `insert into public.guardian_contacts (full_name, relationship, phone, whatsapp, origin)
       values ('Mzazi Students', 'Mother', $1, null, 'admission_form') returning id`,
      [`+2556${String(randomInt(10_000_000, 100_000_000))}`],
    )
    const status = spec.status ?? "Applied"
    const inserted = await sql.query<{ id: string }>(
      `insert into public.leads (
           admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, visit_date,
           guardian_contact_id, referral_code, declined_reason, declined_explanation, closure, closure_reason, created_at
       ) values ($1, $2, 'STD 3', 2027, 'Day', $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, now()))
       returning id`,
      [
        admissionNumber,
        spec.name,
        status,
        status === "Applied" ? null : "2026-09-01",
        contact.rows[0].id,
        spec.code,
        status === "Declined" ? "Did not pass interview" : null,
        status === "Declined" ? "Staff-only explanation" : null,
        spec.closure ?? null,
        spec.closure ? "Family requested closure" : null,
        spec.createdAt ?? null,
      ],
    )
    return inserted.rows[0].id
  })
}

export type StudentInterview = { result: "Passed" | "Failed"; score: number; paid: boolean; registeredAt: string }

// An interview with its result on `leadId`, its fee Paid (TZS 50,000) or not.
export async function studentInterview(leadId: string, spec: StudentInterview): Promise<void> {
  await asSystem(async (sql) => {
    const counter = await sql.query<{ last_number: number }>(
      `insert into public.interview_serial_counters (enrollment_year, last_number) values (2027, 1)
       on conflict (enrollment_year) do update set last_number = public.interview_serial_counters.last_number + 1
       returning last_number`,
    )
    await sql.query(
      `insert into public.interviews (
           lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score, fee_status, locked_amount, locked_discount_applied
       ) values ($1, $2, 2027, $3, $4, '2026-09-10', $5, $6, $7, $8, $9)`,
      [
        leadId,
        counter.rows[0].last_number,
        spec.registeredAt,
        ADMISSIONS.id,
        spec.result,
        spec.score,
        spec.paid ? "Paid" : "Not Paid",
        spec.paid ? 50000 : null,
        spec.paid ? false : null,
      ],
    )
  })
}
