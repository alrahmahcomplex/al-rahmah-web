import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { createLead } from "@/lib/services/leads"
import { approveAgent, listAgents, registerAgent } from "@/lib/services/marketing-agents"
import { findReferralAgent, getLeadReferral, setLeadReferralCode } from "@/lib/services/referral"

import { anonClient, asSystem, createThrowawayStaff, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// A lead's Referral code through the referral module, against local Supabase,
// signed in as each seeded role. Tests that change a code make their own
// leads and agents; the seeded ones are only read or refused.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 4's seeded agents and the open leads carrying their codes.
const PENDING = { code: "ZNM-401", fullName: "Zawadi Neema Mwakasege" }
const APPROVED = { code: "BJN-402", fullName: "Baraka Juma Njoroge" }
const ASHA_APPROVED = "1ead0000-0000-4000-8000-000000000431"
const JUMA_PENDING = "1ead0000-0000-4000-8000-000000000432"
const TATU_UNRECOGNISED = "1ead0000-0000-4000-8000-000000000433"
// Slice 2's seeded closed leads.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const DECLINED = "1ead0000-0000-4000-8000-000000000006"

async function newLead(): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Referral Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

// A Pending agent of the test's own, with a number clear of the seeded ones.
async function newAgent() {
  const fullName = `Rehema Referral ${randomUUID().slice(0, 6)}`
  const registered = await registerAgent(secretClient(), {
    fullName,
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
  })
  if (!registered.ok) throw new Error(`could not register: ${JSON.stringify(registered.error)}`)
  const list = await listAgents(await signedIn(MANAGER), { status: "all", query: registered.data.code, page: 1 })
  const agent = list.ok ? list.data.agents.find((a) => a.code === registered.data.code) : undefined
  if (!agent) throw new Error("could not find the new agent")
  return agent
}

describe("reading a lead's Referral code", () => {
  test("an Approved agent's code names the agent and brings the fee to TZS 30,000", async () => {
    expect(await getLeadReferral(await signedIn(ADMISSIONS), ASHA_APPROVED)).toEqual({
      ok: true,
      data: { code: APPROVED.code, state: "approved", agentName: APPROVED.fullName, amount: 30000, discountApplied: true },
    })
  })

  test("a Pending agent's code names the agent and keeps the fee at TZS 50,000", async () => {
    expect(await getLeadReferral(await signedIn(ADMISSIONS), JUMA_PENDING)).toEqual({
      ok: true,
      data: { code: PENDING.code, state: "pending", agentName: PENDING.fullName, amount: 50000, discountApplied: false },
    })
  })

  test("a code no agent holds is Unrecognised, with no name and the full fee", async () => {
    expect(await getLeadReferral(await signedIn(ADMISSIONS), TATU_UNRECOGNISED)).toEqual({
      ok: true,
      data: { code: "XYZ-999", state: "unrecognised", agentName: null, amount: 50000, discountApplied: false },
    })
  })

  test("a lead with no code has no state and the full fee", async () => {
    expect(await getLeadReferral(await signedIn(ADMISSIONS), await newLead())).toEqual({
      ok: true,
      data: { code: null, state: null, agentName: null, amount: 50000, discountApplied: false },
    })
  })

  test("the Accountant reads it; a lead that doesn't exist is not found", async () => {
    const accountant = await signedIn(ACCOUNTANT)
    expect(await getLeadReferral(accountant, ASHA_APPROVED)).toMatchObject({ ok: true, data: { code: APPROVED.code } })
    expect(await getLeadReferral(accountant, randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await getLeadReferral(accountant, "not-a-uuid")).toEqual({ ok: false, error: "not-found" })
  })

  test("nobody without leads.view reads a code: not anon, not a staff member without it", async () => {
    const anon = anonClient()
    const read = await anon.from("leads").select("referral_code").eq("id", ASHA_APPROVED)
    expect(read.data ?? []).toEqual([])
    expect(await getLeadReferral(anon, ASHA_APPROVED)).toEqual({ ok: false, error: "not-found" })

    const outsider = await createThrowawayStaff([])
    expect(await getLeadReferral(await signedIn(outsider), ASHA_APPROVED)).toEqual({ ok: false, error: "not-found" })
  })
})

describe("setting a lead's Referral code", () => {
  test("Admissions Staff enter a Pending agent's code, then change it to an Approved one", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)

    expect(await setLeadReferralCode(staff, lead, PENDING.code)).toEqual({ ok: true, data: { code: PENDING.code } })
    expect(await getLeadReferral(staff, lead)).toMatchObject({ ok: true, data: { state: "pending", amount: 50000 } })

    expect(await setLeadReferralCode(staff, lead, APPROVED.code)).toEqual({ ok: true, data: { code: APPROVED.code } })
    expect(await getLeadReferral(staff, lead)).toMatchObject({
      ok: true,
      data: { state: "approved", agentName: APPROVED.fullName, amount: 30000, discountApplied: true },
    })
  })

  test("codes are matched however they are typed, and stored normalized", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const typed of ["bjn-402", " BJN-402 ", "bjn -402", "B J N-402"]) {
      const lead = await newLead()
      expect(await setLeadReferralCode(staff, lead, typed), typed).toEqual({ ok: true, data: { code: APPROVED.code } })
    }
  })

  test("a code no agent holds is refused, and so is one that can't be a code; nothing changes", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    for (const typed of ["NOPE-000", "XYZ-999", "", "   ", "ABC_123", "x".repeat(21)]) {
      expect(await setLeadReferralCode(staff, lead, typed), typed).toEqual({ ok: false, error: "unknown-code" })
    }
    expect(await getLeadReferral(staff, lead)).toMatchObject({ ok: true, data: { code: null } })
  })

  test("staff correct an Unrecognised code to a real one", async () => {
    const lead = await newLead()
    // As the Admission form keeps a mistyped code.
    await asSystem((sql) => sql.query("update public.leads set referral_code = 'XYZ-999' where id = $1", [lead]))
    const staff = await signedIn(MANAGER)
    expect(await getLeadReferral(staff, lead)).toMatchObject({ ok: true, data: { state: "unrecognised" } })
    expect(await setLeadReferralCode(staff, lead, " znm-401")).toEqual({ ok: true, data: { code: PENDING.code } })
  })

  test("null clears the code and the fee goes back to TZS 50,000", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    await setLeadReferralCode(staff, lead, APPROVED.code)

    expect(await setLeadReferralCode(staff, lead, null)).toEqual({ ok: true, data: { code: null } })
    expect(await getLeadReferral(staff, lead)).toEqual({
      ok: true,
      data: { code: null, state: null, agentName: null, amount: 50000, discountApplied: false },
    })
  })

  test("setting the code the lead already holds, however typed, or clearing none, is no_change", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    expect(await setLeadReferralCode(staff, lead, null)).toEqual({ ok: false, error: "no-change" })
    await setLeadReferralCode(staff, lead, PENDING.code)
    expect(await setLeadReferralCode(staff, lead, "znm-401")).toEqual({ ok: false, error: "no-change" })
  })

  test("a Declined, Inactive or Archived lead is refused as lead_closed", async () => {
    const staff = await signedIn(MANAGER)
    for (const lead of [ARCHIVED, DECLINED]) {
      expect(await setLeadReferralCode(staff, lead, APPROVED.code), lead).toEqual({ ok: false, error: "lead-closed" })
    }
  })

  test("the Accountant, anon and the secret key are refused; a missing lead is not found", async () => {
    const lead = await newLead()
    expect(await setLeadReferralCode(await signedIn(ACCOUNTANT), lead, APPROVED.code)).toEqual({ ok: false, error: "forbidden" })
    expect(await setLeadReferralCode(anonClient(), lead, APPROVED.code)).toEqual({ ok: false, error: "forbidden" })
    expect(await setLeadReferralCode(secretClient(), lead, APPROVED.code)).toEqual({ ok: false, error: "forbidden" })
    expect(await getLeadReferral(await signedIn(ADMISSIONS), lead)).toMatchObject({ ok: true, data: { code: null } })

    expect(await setLeadReferralCode(await signedIn(ADMISSIONS), randomUUID(), APPROVED.code)).toEqual({
      ok: false,
      error: "not-found",
    })
  })

  test("every change shows in the lead's history with the old and new code and the staff member", async () => {
    const lead = await newLead()
    await setLeadReferralCode(await signedIn(ADMISSIONS), lead, PENDING.code)
    await setLeadReferralCode(await signedIn(MANAGER), lead, APPROVED.code)
    await setLeadReferralCode(await signedIn(ADMISSIONS), lead, null)

    const history = await getLeadHistory(await signedIn(ACCOUNTANT), lead)
    if (!history.ok) throw new Error("history failed")
    const changes = history.data.entries
      .filter((e) => e.record === "lead" && e.action === "update")
      .map((e) => ({ actor: e.actor, change: e.changes.find((c) => c.field === "referral_code") }))
    expect(changes).toEqual([
      { actor: ADMISSIONS.name, change: { field: "referral_code", from: APPROVED.code, to: null } },
      { actor: MANAGER.name, change: { field: "referral_code", from: PENDING.code, to: APPROVED.code } },
      { actor: ADMISSIONS.name, change: { field: "referral_code", from: null, to: PENDING.code } },
    ])
  })
})

describe("expected_interview_amount", () => {
  async function amountOf(leadId: string, as = ACCOUNTANT) {
    const { data, error } = await (await signedIn(as)).rpc("expected_interview_amount", { lead_id: leadId }).single()
    if (error) throw new Error(error.message)
    return data
  }

  test("no code, Unrecognised and Pending pay TZS 50,000; Approved pays TZS 30,000", async () => {
    expect(await amountOf(await newLead())).toEqual({ amount: 50000, discount_applied: false })
    expect(await amountOf(TATU_UNRECOGNISED)).toEqual({ amount: 50000, discount_applied: false })
    expect(await amountOf(JUMA_PENDING)).toEqual({ amount: 50000, discount_applied: false })
    expect(await amountOf(ASHA_APPROVED)).toEqual({ amount: 30000, discount_applied: true })
  })

  test("approving the agent drops the fee at once on a lead that already carries the code", async () => {
    const agent = await newAgent()
    const [one, other] = await Promise.all([newLead(), newLead()])
    const staff = await signedIn(ADMISSIONS)
    await setLeadReferralCode(staff, one, agent.code)
    await setLeadReferralCode(staff, other, agent.code.toLowerCase())
    expect(await amountOf(one)).toEqual({ amount: 50000, discount_applied: false })

    expect(await approveAgent(await signedIn(MANAGER), agent.id)).toEqual({ ok: true, data: null })
    expect(await amountOf(one)).toEqual({ amount: 30000, discount_applied: true })
    expect(await getLeadReferral(staff, other)).toMatchObject({ ok: true, data: { state: "approved", amount: 30000 } })
  })

  test("is forbidden without leads.view, closed to anon, and open to the secret key", async () => {
    const outsider = await createThrowawayStaff([])
    const refused = await (await signedIn(outsider)).rpc("expected_interview_amount", { lead_id: ASHA_APPROVED })
    expect(refused.error?.message).toBe("forbidden")

    const anon = await anonClient().rpc("expected_interview_amount", { lead_id: ASHA_APPROVED })
    expect(anon.error).not.toBeNull()
    expect(anon.data).toBeNull()

    const server = await secretClient().rpc("expected_interview_amount", { lead_id: ASHA_APPROVED }).single()
    expect(server.data).toEqual({ amount: 30000, discount_applied: true })
  })

  test("a lead that doesn't exist is not_found", async () => {
    const { error } = await (await signedIn(ACCOUNTANT)).rpc("expected_interview_amount", { lead_id: randomUUID() })
    expect(error?.message).toBe("not_found")
  })
})

describe("finding the agent a typed code belongs to", () => {
  test("matches however it is typed, and finds no one for an unknown code", async () => {
    const staff = await signedIn(ACCOUNTANT)
    expect(await findReferralAgent(staff, " znm -401")).toEqual({
      ok: true,
      data: { code: PENDING.code, fullName: PENDING.fullName, state: "pending" },
    })
    expect(await findReferralAgent(staff, "BJN-402")).toEqual({
      ok: true,
      data: { code: APPROVED.code, fullName: APPROVED.fullName, state: "approved" },
    })
    expect(await findReferralAgent(staff, "XYZ-999")).toEqual({ ok: true, data: null })
    expect(await findReferralAgent(staff, "not a code!")).toEqual({ ok: true, data: null })
  })

  test("finds no one for staff without leads.view, and is closed to anon", async () => {
    const outsider = await createThrowawayStaff([])
    expect(await findReferralAgent(await signedIn(outsider), APPROVED.code)).toEqual({ ok: true, data: null })
    const anon = await anonClient().rpc("find_marketing_agent", { typed_code: APPROVED.code })
    expect(anon.data ?? []).toEqual([])
  })
})

describe("each code's lead count on the Marketing Agents list", () => {
  test("counts every lead carrying the agent's code", async () => {
    const agent = await newAgent()
    expect(agent.leadCount).toBe(0)
    const staff = await signedIn(ADMISSIONS)
    const [one, other] = await Promise.all([newLead(), newLead()])
    await setLeadReferralCode(staff, one, agent.code)
    await setLeadReferralCode(staff, other, agent.code)

    const list = await listAgents(await signedIn(ACCOUNTANT), { status: "all", query: agent.code, page: 1 })
    expect(list.ok && list.data.agents.map((a) => [a.code, a.leadCount])).toEqual([[agent.code, 2]])

    const seeded = await listAgents(staff, { status: "all", query: APPROVED.code, page: 1 })
    expect(seeded.ok && seeded.data.agents[0].leadCount).toBeGreaterThanOrEqual(1)
  })
})
