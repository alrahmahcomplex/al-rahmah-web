import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { AdmissionChild, AdmissionForm } from "@/lib/admission-form"
import { admissionYears } from "@/lib/admission-form"
import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"
import { getLeadHistory } from "@/lib/services/audit"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { applyFormDiscountCode, estimateDiscountCode, getLeadReferral, setLeadReferralCode } from "@/lib/services/referral"

import { anonClient, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The Discount code on the Admission form (#83) against local Supabase: the
// form's estimate, and the code reaching every lead the form creates, through
// the admission-form service with the secret key the Server Action holds.
// Read back as seeded staff. Each test invents its own families, clear of the
// seeded +255 700 000 xxx fixtures.

const PENDING = "ZNM-401"
const APPROVED = "BJN-402"
// Slice 2's seeded Archived lead, which carries no code.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"

const [, nextYear] = admissionYears()

function child(): AdmissionChild {
  return { fullName: `Code Pupil ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: nextYear, dayOrBoarding: "Day" }
}

function form(overrides: Partial<AdmissionForm> = {}): AdmissionForm {
  return {
    submissionKey: randomUUID(),
    parent: { fullName: "Code Parent", relationship: "Father", phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    children: [child()],
    ...overrides,
  }
}

async function leadIdOf(name: string): Promise<string> {
  const rows = await inRolledBackTransaction(
    async (sql) => (await sql.query("select id from public.leads where student_name = $1", [name])).rows as { id: string }[],
  )
  if (rows.length !== 1) throw new Error(`expected one lead named ${name}, found ${rows.length}`)
  return rows[0].id
}

async function codeOf(name: string): Promise<string | null> {
  const referral = await getLeadReferral(await signedIn(ADMISSIONS), await leadIdOf(name))
  if (!referral.ok) throw new Error("could not read the code")
  return referral.data.code
}

async function codeChanges(leadId: string) {
  const history = await getLeadHistory(await signedIn(ADMISSIONS), leadId)
  if (!history.ok) throw new Error("history failed")
  return history.data.entries
    .filter((e) => e.record === "lead" && e.changes.some((c) => c.field === "referral_code"))
    .map((e) => ({ actor: e.actor, action: e.action, change: e.changes.find((c) => c.field === "referral_code") }))
}

// The secret-key client, except that putting a code on a lead fails, as when
// the connection drops between a child's creation and its code.
function failingCodeStep(): SupabaseClient {
  const client = secretClient()
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "rpc") return Reflect.get(target, property, receiver)
      return (name: string, ...rest: unknown[]) =>
        name === "apply_form_discount_code"
          ? Promise.resolve({ data: null, error: { message: "fetch failed", code: "", details: "", hint: "" } })
          : (target.rpc as (...args: unknown[]) => unknown).call(target, name, ...rest)
    },
  })
}

describe("estimating a Discount code for the form", () => {
  test("an Approved agent's code brings the fee per child to TZS 30,000, matched however it is typed", async () => {
    expect(await estimateDiscountCode(secretClient(), " bjn -402 ")).toEqual({ ok: true, data: { state: "approved", amount: 30000 } })
  })

  test("a Pending agent's code, an unknown one and a value that isn't a code keep the standard fee", async () => {
    expect(await estimateDiscountCode(secretClient(), PENDING)).toEqual({ ok: true, data: { state: "pending", amount: 50000 } })
    expect(await estimateDiscountCode(secretClient(), "QQQ-000")).toEqual({ ok: true, data: { state: "unknown", amount: 50000 } })
    expect(await estimateDiscountCode(secretClient(), "")).toEqual({ ok: true, data: { state: "unknown", amount: 50000 } })
    expect(await estimateDiscountCode(secretClient(), "ABC_123!")).toEqual({ ok: true, data: { state: "unknown", amount: 50000 } })
  })

  test("the form's standard fee is the database's", async () => {
    const estimate = await estimateDiscountCode(secretClient(), "")
    expect(estimate.ok && estimate.data.amount).toBe(STANDARD_INTERVIEW_FEE)
  })

  test("agrees with expected_interview_amount for the same code", async () => {
    const asha = "1ead0000-0000-4000-8000-000000000431"
    const { data } = await (await signedIn(ACCOUNTANT)).rpc("expected_interview_amount", { lead_id: asha }).single<{ amount: number }>()
    const estimate = await estimateDiscountCode(secretClient(), APPROVED)
    expect(estimate.ok && estimate.data.amount).toBe(data?.amount)
  })

  test("no visitor and no staff member may call it", async () => {
    for (const client of [anonClient(), await signedIn(MANAGER)]) {
      expect(await estimateDiscountCode(client, APPROVED)).toEqual({ ok: false, error: "unavailable" })
    }
  })
})

describe("the form's Discount code on the leads it creates", () => {
  test("every child the form creates carries the code, normalized", async () => {
    const sent = form({ children: [child(), child(), child()], discountCode: "BJN-402" })
    const result = await submitAdmissionForm(secretClient(), sent)
    expect(result.ok).toBe(true)

    for (const c of sent.children) expect(await codeOf(c.fullName)).toBe(APPROVED)
    const referral = await getLeadReferral(await signedIn(ADMISSIONS), await leadIdOf(sent.children[0].fullName))
    expect(referral.ok && referral.data).toMatchObject({ state: "approved", amount: 30000, discountApplied: true })
  })

  test("a code no agent holds is kept as Unrecognised, at the full fee", async () => {
    const sent = form({ discountCode: "QQQ-000" })
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)

    const referral = await getLeadReferral(await signedIn(ADMISSIONS), await leadIdOf(sent.children[0].fullName))
    expect(referral.ok && referral.data).toEqual({
      code: "QQQ-000",
      state: "unrecognised",
      agentName: null,
      amount: 50000,
      discountApplied: false,
    })
  })

  test("a form without a code leaves the lead without one", async () => {
    const sent = form()
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)
    expect(await codeOf(sent.children[0].fullName)).toBeNull()
  })

  test("the lead's history shows the code from the Admission form", async () => {
    const sent = form({ discountCode: PENDING })
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)

    expect(await codeChanges(await leadIdOf(sent.children[0].fullName))).toEqual([
      { actor: "Admission form", action: "update", change: { field: "referral_code", from: null, to: PENDING } },
    ])
  })

  test("sending the same form again writes no history and never overwrites a code staff set in between", async () => {
    const sent = form({ discountCode: "QQQ-000" })
    const first = await submitAdmissionForm(secretClient(), sent)
    const lead = await leadIdOf(sent.children[0].fullName)

    expect(await submitAdmissionForm(secretClient(), sent)).toEqual(first)
    expect(await codeChanges(lead)).toHaveLength(1)

    // Staff fix the typo, then the parent's phone sends the form once more.
    expect((await setLeadReferralCode(await signedIn(ADMISSIONS), lead, PENDING)).ok).toBe(true)
    expect(await submitAdmissionForm(secretClient(), sent)).toEqual(first)
    expect(await codeOf(sent.children[0].fullName)).toBe(PENDING)
    expect((await codeChanges(lead)).map((c) => c.actor)).toEqual([ADMISSIONS.name, "Admission form"])
  })

  test("the same key with a different code is an edit, and changes nothing", async () => {
    const sent = form({ discountCode: PENDING })
    const first = await submitAdmissionForm(secretClient(), sent)
    if (!first.ok) throw new Error("setup failed")

    const edited = await submitAdmissionForm(secretClient(), { ...sent, discountCode: APPROVED })
    expect(edited).toEqual({ ok: false, error: { kind: "already-sent", children: first.data, complete: true } })
    expect(await codeOf(sent.children[0].fullName)).toBe(PENDING)
  })

  test("a send cut off before the code step stops unavailable, and a retry with the same key finishes it", async () => {
    const sent = form({ children: [child(), child()], discountCode: APPROVED })

    expect(await submitAdmissionForm(failingCodeStep(), sent)).toEqual({ ok: false, error: { kind: "unavailable" } })
    expect(await codeOf(sent.children[0].fullName)).toBeNull()

    const retried = await submitAdmissionForm(secretClient(), sent)
    expect(retried.ok && retried.data.map((c) => c.fullName)).toEqual(sent.children.map((c) => c.fullName))
    for (const c of sent.children) expect(await codeOf(c.fullName)).toBe(APPROVED)
    expect(await codeChanges(await leadIdOf(sent.children[0].fullName))).toEqual([
      { actor: "Admission form", action: "update", change: { field: "referral_code", from: null, to: APPROVED } },
    ])
  })
})

describe("apply_form_discount_code", () => {
  test("refuses a value that isn't a code", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const lead = await leadIdOf(sent.children[0].fullName)

    expect(await applyFormDiscountCode(secretClient(), lead, "ABC_123!")).toEqual({ ok: false, error: "invalid" })
    expect(await applyFormDiscountCode(secretClient(), lead, "   ")).toEqual({ ok: false, error: "invalid" })
    expect(await codeOf(sent.children[0].fullName)).toBeNull()
  })

  test("leaves a closed lead as it is", async () => {
    expect(await applyFormDiscountCode(secretClient(), ARCHIVED, APPROVED)).toEqual({ ok: false, error: "lead-closed" })
  })

  test("no visitor and no staff member may call it", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const lead = await leadIdOf(sent.children[0].fullName)

    for (const client of [anonClient(), await signedIn(MANAGER)]) {
      expect(await applyFormDiscountCode(client, lead, APPROVED)).toEqual({ ok: false, error: "unavailable" })
    }
    expect(await codeOf(sent.children[0].fullName)).toBeNull()
  })

  test("an anonymous visitor reads no lead's code", async () => {
    const sent = form({ discountCode: APPROVED })
    await submitAdmissionForm(secretClient(), sent)
    const { data } = await anonClient().from("leads").select("referral_code").eq("student_name", sent.children[0].fullName)
    expect(data ?? []).toEqual([])
  })
})
