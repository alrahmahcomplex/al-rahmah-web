import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { AdmissionChild, AdmissionForm } from "@/lib/admission-form"
import { admissionYears } from "@/lib/admission-form"
import { getAdmissionApplicationCount } from "@/lib/services/admission-applications"
import { submitAdmissionForm } from "@/lib/services/admission-form"

import { anonClient, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS, SUPER_ADMIN } from "../support/fixtures"

// admission_form_application_count(): the number behind the public form's
// "we already have N applications". One integer for the secret key, nobody
// else. Other test files send forms at the same time, so exact counts are
// checked on a frozen snapshot, and counts through the API only grow.

const [, nextYear] = admissionYears()

function phone() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

function child(): AdmissionChild {
  return { fullName: `Count Pupil ${randomUUID().slice(0, 8)}`, className: "KG 2", enrollmentYear: nextYear, dayOrBoarding: "Day" }
}

function form(children: AdmissionChild[]): AdmissionForm {
  return { submissionKey: randomUUID(), parent: { fullName: "Count Parent", relationship: "Father", phone: phone() }, children }
}

async function count(): Promise<number> {
  const read = await getAdmissionApplicationCount(secretClient())
  if (!read.ok) throw new Error("could not read the count")
  return read.data
}

// A submission row as the form writes it, with `children` outcomes.
async function insertSubmission(sql: Client, createdAt: string, children: number) {
  const outcomes = Object.fromEntries(Array.from({ length: children }, (_, i) => [String(i), { result: "created" }]))
  await sql.query(
    `insert into public.admission_submissions (submission_key, payload_hash, child_count, outcomes, created_at)
     values ($1, repeat('a', 64), greatest($2::integer, 1), $3, $4)`,
    [randomUUID(), children, JSON.stringify(outcomes), createdAt],
  )
}

describe("the Admission form application count", () => {
  test("the secret key reads a whole number of zero or more", async () => {
    const read = await getAdmissionApplicationCount(secretClient())
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(Number.isInteger(read.data)).toBe(true)
    expect(read.data).toBeGreaterThanOrEqual(0)
  })

  test("counts each child on this year's forms, Tanzania time, and nothing from last year", async () => {
    const counted = await inRolledBackTransaction(async (sql) => {
      // One snapshot for the whole transaction, so forms other tests send
      // meanwhile don't move the numbers.
      await sql.query("set transaction isolation level repeatable read")
      const read = async () =>
        (await sql.query<{ n: number }>("select public.admission_form_application_count() as n")).rows[0].n
      const { rows } = await sql.query<{ starts: string }>(
        `select extract(epoch from date_trunc('year', now() at time zone 'Africa/Dar_es_Salaam')
                                     at time zone 'Africa/Dar_es_Salaam')::text as starts`,
      )
      const yearStarts = new Date(Number(rows[0].starts) * 1000)
      const before = await read()

      await insertSubmission(sql, new Date().toISOString(), 1)
      await insertSubmission(sql, new Date().toISOString(), 2)
      // A submission whose children were never created counts nothing.
      await insertSubmission(sql, new Date().toISOString(), 0)
      // 00:00 on 1 January in Dar es Salaam (UTC+3) is this year; a second
      // earlier, still 31 December there, is last year, though it is already
      // 21:00 on 31 December in UTC either way.
      await insertSubmission(sql, yearStarts.toISOString(), 1)
      await insertSubmission(sql, new Date(yearStarts.getTime() - 1000).toISOString(), 4)

      return { before, after: await read() }
    })
    expect(counted.after - counted.before).toBe(4)
  })

  test("a one-child and a two-child form sent through the service raise it by at least 3", async () => {
    const before = await count()
    const sent = await Promise.all([
      submitAdmissionForm(secretClient(), form([child()])),
      submitAdmissionForm(secretClient(), form([child(), child()])),
    ])
    expect(sent.every((result) => result.ok)).toBe(true)
    expect((await count()) - before).toBeGreaterThanOrEqual(3)
  })

  test("is granted to the secret key only", async () => {
    const grants = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ role: string; granted: boolean }>(
        `select r.role, has_function_privilege(r.role, 'public.admission_form_application_count()', 'execute') as granted
         from unnest(array['anon', 'authenticated', 'service_role']) r (role)
         order by r.role`,
      )
      return rows
    })
    expect(grants).toEqual([
      { role: "anon", granted: false },
      { role: "authenticated", granted: false },
      { role: "service_role", granted: true },
    ])
  })

  test("anonymous visitors and signed-in staff are refused", async () => {
    for (const client of [anonClient(), await signedIn(ADMISSIONS), await signedIn(SUPER_ADMIN)]) {
      const { data, error } = await client.rpc("admission_form_application_count")
      expect(data).toBeNull()
      expect(error?.code).toMatch(/^(42501|PGRST202)$/)
    }
  })
})
