import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"
import { getInterviewDiscount } from "@/lib/services/referral"

import { anonClient, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS } from "../support/fixtures"

// The agent interview discount (#181): interview_fee() holds the two amounts,
// and interview_discount() is the gap between them, the one figure every
// screen states.

describe("the interview amounts", () => {
  test("are TZS 50,000, or TZS 40,000 with an Approved agent's code", async () => {
    const amounts = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ full: number; discounted: number; discount: number }>(
        "select public.interview_fee(false) as full, public.interview_fee(true) as discounted, public.interview_discount() as discount",
      )
      return rows[0]
    })
    expect(amounts).toEqual({ full: 50000, discounted: 40000, discount: 10000 })
    expect(amounts.full).toBe(STANDARD_INTERVIEW_FEE)
  })

  test("interview_fee and interview_discount are stable, and interview_discount is security definer", async () => {
    const functions = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ name: string; volatility: string; definer: boolean }>(
        `select p.proname as name, p.provolatile as volatility, p.prosecdef as definer
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('interview_fee', 'interview_discount')
         order by p.proname`,
      )
      return rows
    })
    expect(functions).toEqual([
      { name: "interview_discount", volatility: "s", definer: true },
      { name: "interview_fee", volatility: "s", definer: false },
    ])
  })
})

describe("reading the interview discount", () => {
  test("any signed-in staff member and the secret key read TZS 10,000", async () => {
    const nobody = await createThrowawayStaff([])
    for (const client of [await signedIn(ADMISSIONS), await signedIn(ACCOUNTANT), await signedIn(nobody), secretClient()]) {
      expect(await getInterviewDiscount(client)).toEqual({ ok: true, data: 10000 })
    }
  })

  // interview_fee keeps the grants it had before #181: no visitor or
  // signed-in role, and the secret key as Supabase grants it by default.
  test("interview_discount is granted to signed-in staff and the secret key only; interview_fee to no visitor or staff", async () => {
    const grants = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ role: string; fn: string; granted: boolean }>(
        `select r.role, f.fn, has_function_privilege(r.role, f.fn, 'execute') as granted
         from unnest(array['anon', 'authenticated', 'service_role']) r (role)
         cross join unnest(array['public.interview_discount()', 'public.interview_fee(boolean)']) f (fn)
         order by f.fn, r.role`,
      )
      return rows
    })
    expect(grants).toEqual([
      { role: "anon", fn: "public.interview_discount()", granted: false },
      { role: "authenticated", fn: "public.interview_discount()", granted: true },
      { role: "service_role", fn: "public.interview_discount()", granted: true },
      { role: "anon", fn: "public.interview_fee(boolean)", granted: false },
      { role: "authenticated", fn: "public.interview_fee(boolean)", granted: false },
      { role: "service_role", fn: "public.interview_fee(boolean)", granted: true },
    ])
  })

  test("an anonymous visitor may not call it, and neither a visitor nor staff may call interview_fee", async () => {
    expect(await getInterviewDiscount(anonClient())).toEqual({ ok: false, error: "unavailable" })

    for (const client of [anonClient(), await signedIn(ADMISSIONS)]) {
      const { data, error } = await client.rpc("interview_fee", { discounted: true })
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    }
  })
})
