import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getAgentAccountCounts, getAgentInvites, sendAgentInvite, setAgentEmail, type AgentInviteSender } from "@/lib/services/agent-invites"
import { confirmEmailClaim, getEmailClaimQueue, getSignUpNotes, rejectEmailClaim } from "@/lib/services/agent-email-claims"
import { signUpAgent, type SignUp } from "@/lib/services/agent-sign-up"
import { listAgentsInAccountState } from "@/lib/services/agent-account-list"
import { changeAgentStatus, createAgent } from "@/lib/services/marketing-agents"
import { createLead } from "@/lib/services/leads"
import { setLeadReferralCode } from "@/lib/services/referral"
import { tanzaniaToday } from "@/lib/school-calendar"

import { asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// Sign-up with an email and claiming an existing Discount code (#193), Seam 1:
// the services against local Supabase, every row of the decision table, the
// queue's Confirm, Reject and Save and send invite, competing claims, the
// automatic rejection, and that a stored email is never overwritten. Every
// agent is the test's own, with invented names, numbers and example.test
// emails; the invite sender is stubbed, so nothing is mailed.

const REDIRECT = "http://localhost:3100/discount-code/set-password"

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`
}

const asE164 = (local: string) => `+255${local.slice(1)}`

const sent: AgentInviteSender = async () => ({ error: null })

// An Approved agent the Manager created, as an imported agent arrives: with
// no email unless one is given.
async function existingAgent(address: string | null = null) {
  const fullName = `Zawadi Claim ${randomUUID().slice(0, 8)}`
  const number = phone()
  const created = await createAgent(await signedIn(MANAGER), { fullName, phone: number, whatsapp: "", email: address ?? "", code: "" })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  return { id: created.data.agent.id, code: created.data.agent.code, fullName, phone: number }
}

function signUp(change: Partial<SignUp>): Promise<ReturnType<typeof signUpAgent> extends Promise<infer R> ? R : never> {
  return signUpAgent(secretClient(), {
    fullName: `Amani Mpya ${randomUUID().slice(0, 6)}`,
    phone: phone(),
    whatsapp: null,
    email: email("new"),
    hasCode: false,
    code: null,
    ...change,
  })
}

async function outcome(change: Partial<SignUp>) {
  const result = await signUp(change)
  if (!result.ok) throw new Error(`sign-up refused: ${JSON.stringify(result.error)}`)
  return result.data
}

async function db<T>(query: string, params: unknown[]): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

const claimsOf = (agentId: string) =>
  db<{ id: string; claim_id: string | null; outcome: string; full_name: string | null; email: string | null; decided_by: string | null }>(
    "select id, claim_id, outcome, full_name, email, decided_by from public.agent_email_claims where agent_id = $1 order by created_at, id",
    [agentId],
  )

const storedEmail = async (agentId: string) =>
  (await db<{ email: string | null }>("select email from public.marketing_agents where id = $1", [agentId]))[0].email

const agentsWithPhone = (local: string) =>
  db<{ id: string; full_name: string; code: string; status: string; email: string | null; typed_code: string | null }>(
    "select id, full_name, code, status, email, typed_code from public.marketing_agents where phone = $1",
    [asE164(local)],
  )

async function stateOf(agentId: string) {
  const invites = await getAgentInvites(await signedIn(MANAGER), [agentId])
  if (!invites.ok) throw new Error(invites.error)
  return invites.data.get(agentId)?.state ?? null
}

async function queueEntry(agentId: string) {
  const queue = await getEmailClaimQueue(await signedIn(MANAGER))
  if (!queue.ok) throw new Error(queue.error)
  return queue.data.find((entry) => entry.agentId === agentId) ?? null
}

// A waiting claim on a fresh imported agent, by the agent's own phone.
async function claimed() {
  const agent = await existingAgent()
  const address = email("claim")
  const typedName = `${agent.fullName} Mwenyewe`
  expect(await outcome({ fullName: typedName, phone: agent.phone, email: address, hasCode: true, code: agent.code.toLowerCase() })).toEqual({
    kind: "claimed",
    code: agent.code,
  })
  return { agent, address, typedName }
}

describe("the sign-up form", () => {
  test("1. code and mobile match an agent with no email: the claim waits, the email is not stored", async () => {
    const { agent, address, typedName } = await claimed()

    expect(await claimsOf(agent.id)).toEqual([
      expect.objectContaining({ claim_id: null, outcome: "pending", full_name: typedName, email: address, decided_by: null }),
    ])
    expect(await storedEmail(agent.id)).toBeNull()
    expect(await stateOf(agent.id)).toBe("awaiting_confirmation")

    const entry = await queueEntry(agent.id)
    expect(entry).toMatchObject({ fullName: agent.fullName, code: agent.code, phone: asE164(agent.phone), status: "Approved" })
    expect(entry?.claims).toEqual([expect.objectContaining({ fullName: typedName, email: address })])

    const counts = await getAgentAccountCounts(await signedIn(MANAGER))
    expect(counts.ok && counts.data.awaiting_confirmation).toBeGreaterThan(0)
  })

  test("2. the mobile has a code but the box isn't ticked: nothing is created", async () => {
    const agent = await existingAgent()
    expect(await outcome({ phone: agent.phone })).toEqual({ kind: "code_needed" })
    expect(await outcome({ phone: agent.phone, code: "ZZ-999" })).toEqual({ kind: "code_needed" })
    expect(await agentsWithPhone(agent.phone)).toHaveLength(1)
    expect(await claimsOf(agent.id)).toEqual([])
  })

  test("3. the box is ticked and the code matches, but the mobile doesn't: nothing is created, the refusal is recorded", async () => {
    const agent = await existingAgent()
    const other = phone()
    expect(await outcome({ phone: other, hasCode: true, code: agent.code })).toEqual({ kind: "phone_mismatch" })
    expect(await agentsWithPhone(other)).toEqual([])
    expect(await claimsOf(agent.id)).toEqual([])
    expect(
      await db("select result, email from public.agent_events where agent_id = $1 and kind = 'claim'", [agent.id]),
    ).toEqual([{ result: "phone_mismatch", email: null }])
  })

  test("4. the box is ticked and nothing matches, switched-off and retired agents included: nothing is created", async () => {
    const before = Number((await db<{ n: string }>("select count(*) as n from public.agent_events where kind = 'claim' and result = 'no_match'", []))[0].n)
    const unknown = phone()
    expect(await outcome({ phone: unknown, hasCode: true, code: `NO-${randomInt(1000, 9999)}` })).toEqual({ kind: "no_match" })
    expect(await agentsWithPhone(unknown)).toEqual([])

    const manager = await signedIn(MANAGER)
    const off = await existingAgent()
    expect((await changeAgentStatus(manager, off.id, "switch-off", "Testing claims")).ok).toBe(true)
    expect(await outcome({ phone: off.phone, hasCode: true, code: off.code })).toEqual({ kind: "no_match" })

    const retired = await existingAgent()
    expect((await changeAgentStatus(manager, retired.id, "retire", "Testing claims")).ok).toBe(true)
    expect(await outcome({ phone: retired.phone, hasCode: true, code: retired.code })).toEqual({ kind: "no_match" })

    expect(await claimsOf(off.id)).toEqual([])
    expect(await claimsOf(retired.id)).toEqual([])
    // Recorded with the reason only: no agent, no email.
    const rows = await db<{ agent_id: string | null; email: string | null }>(
      "select agent_id, email from public.agent_events where kind = 'claim' and result = 'no_match' order by created_at desc limit 3",
      [],
    )
    expect(rows).toEqual(Array(3).fill({ agent_id: null, email: null }))
    const after = Number((await db<{ n: string }>("select count(*) as n from public.agent_events where kind = 'claim' and result = 'no_match'", []))[0].n)
    expect(after - before).toBeGreaterThanOrEqual(3)
  })

  test("5. a claim already waits: the same email gets a calm reply, another email is recorded as competing", async () => {
    const { agent, address } = await claimed()

    expect(await outcome({ fullName: "Mtu Mwingine", phone: agent.phone, email: address, hasCode: true, code: agent.code })).toEqual({
      kind: "claim_waiting",
    })
    expect(await claimsOf(agent.id)).toHaveLength(1)

    const other = email("competing")
    expect(await outcome({ fullName: "Mtu Mwingine", phone: agent.phone, email: other, hasCode: true, code: agent.code })).toEqual({
      kind: "claim_waiting",
    })
    expect((await claimsOf(agent.id)).map((claim) => [claim.outcome, claim.email])).toEqual([
      ["pending", address],
      ["competing", other],
    ])
    expect((await queueEntry(agent.id))?.claims.map((claim) => claim.email)).toEqual([address, other])
  })

  test("6. invited but not joined: check spam or ask for a new link; the stored email stays", async () => {
    const address = email("invited")
    const agent = await existingAgent(address)
    expect((await sendAgentInvite(await signedIn(MANAGER), sent, agent.id, REDIRECT)).ok).toBe(true)

    expect(await outcome({ phone: agent.phone, email: email("typed"), hasCode: true, code: agent.code })).toEqual({ kind: "invited" })
    expect(await storedEmail(agent.id)).toBe(address)
    expect(await claimsOf(agent.id)).toEqual([])
  })

  test("an agent whose email awaits its first invite gets the calm reply, and the email is never overwritten", async () => {
    const address = email("stored")
    const agent = await existingAgent(address)
    expect(await outcome({ phone: agent.phone, email: email("typed"), hasCode: true, code: agent.code })).toEqual({ kind: "claim_waiting" })
    expect(await storedEmail(agent.id)).toBe(address)
    expect(await claimsOf(agent.id)).toEqual([])
  })

  test("7. already joined: sign in; nothing is read from or written to the stored email", async () => {
    const address = email("joined")
    const agent = await existingAgent(address)
    const login = await secretClient().auth.admin.createUser({ email: address, password: "fixture-password", email_confirm: true })
    if (login.error) throw new Error(login.error.message)

    expect(await outcome({ phone: agent.phone, email: email("typed"), hasCode: true, code: agent.code })).toEqual({ kind: "joined" })
    expect(await storedEmail(agent.id)).toBe(address)
    expect(await claimsOf(agent.id)).toEqual([])
  })

  test("8. a retry with the same details shows the same done page and records nothing more", async () => {
    const { agent, address, typedName } = await claimed()
    expect(await outcome({ fullName: typedName, phone: agent.phone, email: address, hasCode: true, code: agent.code })).toEqual({
      kind: "claimed",
      code: agent.code,
    })
    expect(await claimsOf(agent.id)).toHaveLength(1)

    const who = { fullName: `Baraka Tena ${randomUUID().slice(0, 6)}`, phone: phone(), email: email("again") }
    const first = await outcome(who)
    expect(first).toMatchObject({ kind: "registered", email: who.email })
    if (first.kind !== "registered") throw new Error(`expected a new agent, got ${first.kind}`)
    expect(await outcome(who)).toEqual(first)
    expect(await agentsWithPhone(who.phone)).toHaveLength(1)
    // Another name or email on that phone is someone else's try: tick the box.
    // Neither try touches the record: still one agent, with the first name,
    // code and email. Checked after each try, so a write that the next try
    // put back would show.
    const untouched = [expect.objectContaining({ full_name: who.fullName, code: first.code, email: who.email })]
    expect(await outcome({ ...who, fullName: `${who.fullName} B` })).toEqual({ kind: "code_needed" })
    expect(await agentsWithPhone(who.phone)).toEqual(untouched)
    expect(await outcome({ ...who, email: email("other") })).toEqual({ kind: "code_needed" })
    expect(await agentsWithPhone(who.phone)).toEqual(untouched)
  })

  test("8. an unticked retry for an agent who has joined or was invited says so, reading no stored email once joined", async () => {
    const address = email("retry-invited")
    const invited = await existingAgent(address)
    expect((await sendAgentInvite(await signedIn(MANAGER), sent, invited.id, REDIRECT)).ok).toBe(true)
    expect(await outcome({ fullName: invited.fullName, phone: invited.phone, email: address })).toEqual({ kind: "invited" })

    const joinedAt = email("retry-joined")
    const joined = await existingAgent(joinedAt)
    const login = await secretClient().auth.admin.createUser({ email: joinedAt, password: "fixture-password", email_confirm: true })
    if (login.error) throw new Error(login.error.message)
    // Any email: the stored copy isn't compared once they have joined.
    expect(await outcome({ fullName: joined.fullName, phone: joined.phone, email: email("anything") })).toEqual({ kind: "joined" })
  })

  test("9. no match and the box unticked: a new Pending agent with the email; a free typed code is adopted", async () => {
    const who = { fullName: `Baraka Mpya ${randomUUID().slice(0, 6)}`, phone: phone(), email: email("pending") }
    const done = await outcome(who)
    expect(done).toMatchObject({ kind: "registered", email: who.email })
    const [agent] = await agentsWithPhone(who.phone)
    expect(agent).toMatchObject({ full_name: who.fullName, status: "Pending", email: who.email, typed_code: null })
    expect(done.kind === "registered" && done.code).toBe(agent.code)

    const free = `FR-${randomInt(1000, 9999)}${randomInt(10, 99)}`
    const adopted = await outcome({ phone: phone(), code: free.toLowerCase() })
    expect(adopted).toMatchObject({ kind: "registered", code: free })
  })

  test("9. a typed code another agent holds, or that leads carry, is never adopted and is flagged", async () => {
    const holder = await existingAgent()
    const who = { phone: phone(), code: holder.code }
    const done = await outcome(who)
    expect(done.kind === "registered" && done.code).not.toBe(holder.code)
    const [agent] = await agentsWithPhone(who.phone)
    expect(agent.typed_code).toBe(holder.code)

    const lead = await createLead(await signedIn(ADMISSIONS), {
      guardian: { contact: { fullName: "Claim Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` } },
      student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: Number(tanzaniaToday().slice(0, 4)) + 1, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: tanzaniaToday() },
    })
    if (!lead.ok) throw new Error(JSON.stringify(lead.error))
    expect((await setLeadReferralCode(await signedIn(ADMISSIONS), lead.data.leadId, holder.code)).ok).toBe(true)

    const notes = await getSignUpNotes(await signedIn(MANAGER), [agent.id])
    expect(notes.ok && notes.data.get(agent.id)).toEqual({
      typedCode: holder.code,
      holder: { id: holder.id, fullName: holder.fullName, code: holder.code },
      retiredHolder: false,
      leadCount: 1,
    })
  })

  test("an email staff or another agent uses gets the neutral reply, on both paths", async () => {
    const agent = await existingAgent()
    expect(await outcome({ email: MANAGER.email })).toEqual({ kind: "email_unusable" })
    expect(await outcome({ phone: agent.phone, email: MANAGER.email, hasCode: true, code: agent.code })).toEqual({ kind: "email_unusable" })
    const taken = email("taken")
    await existingAgent(taken)
    expect(await outcome({ email: taken.toUpperCase() })).toEqual({ kind: "email_unusable" })
    expect(await claimsOf(agent.id)).toEqual([])
  })

  test("refuses an empty email, a ticked box with no code, and anyone but the server", async () => {
    expect(await signUp({ email: "" })).toEqual({ ok: false, error: { kind: "invalid", field: "email" } })
    expect(await signUp({ email: "not-an-email" })).toEqual({ ok: false, error: { kind: "invalid", field: "email" } })
    expect(await signUp({ hasCode: true, code: null })).toEqual({ ok: false, error: { kind: "invalid", field: "code" } })
    const staff = await signedIn(MANAGER)
    const { error } = await staff.rpc("sign_up_marketing_agent", {
      full_name: "Mtu", phone: phone(), whatsapp: null, email: email("x"), has_code: false, code: null,
    })
    expect(error?.code).toBe("42501")
  })

  test("sign-up and claiming are refused while agent access is off", async () => {
    const agent = await existingAgent()
    const answers = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_access(false)")
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })])
      const call = (hasCode: boolean, local: string, code: string | null) =>
        sql.query<{ answer: unknown }>("select public.sign_up_marketing_agent('Amani Off', $1, null, $2, $3, $4) as answer", [
          local, email("off"), hasCode, code,
        ])
      const fresh = phone()
      const answers = [(await call(false, fresh, null)).rows[0].answer, (await call(true, agent.phone, agent.code)).rows[0].answer]
      const made = await sql.query("select 1 from public.marketing_agents where phone = $1", [asE164(fresh)])
      const claims = await sql.query("select 1 from public.agent_email_claims where agent_id = $1", [agent.id])
      return { answers, made: made.rowCount, claims: claims.rowCount }
    })
    expect(answers).toEqual({ answers: [{ outcome: "access_off" }, { outcome: "access_off" }], made: 0, claims: 0 })
  })
})

describe("the Manager's queue", () => {
  test("Confirm saves the claimed email, auto-rejects competing claims, and the invite goes out", async () => {
    const { agent, address } = await claimed()
    await outcome({ phone: agent.phone, email: email("rival"), hasCode: true, code: agent.code })
    const [first, second] = (await queueEntry(agent.id))!.claims

    const manager = await signedIn(MANAGER)
    expect(await confirmEmailClaim(manager, first.id)).toEqual({ ok: true, data: { agentId: agent.id, email: address } })
    expect(await storedEmail(agent.id)).toBe(address)
    expect((await claimsOf(agent.id)).filter((row) => row.claim_id)).toEqual([
      expect.objectContaining({ claim_id: first.id, outcome: "confirmed", email: address, decided_by: MANAGER.id }),
      expect.objectContaining({ claim_id: second.id, outcome: "auto_rejected", email: null, decided_by: MANAGER.id }),
    ])
    expect(await queueEntry(agent.id)).toBeNull()
    expect(await stateOf(agent.id)).toBe("invite_not_sent")

    expect(await sendAgentInvite(manager, sent, agent.id, REDIRECT, { expectedEmail: address })).toEqual({
      ok: true,
      data: { email: address, resend: false },
    })
    expect(await stateOf(agent.id)).toBe("invited")
    expect(await confirmEmailClaim(manager, second.id)).toEqual({ ok: false, error: { kind: "already-decided" } })
  })

  test("Save and send invite saves the email the Manager corrected", async () => {
    const { agent } = await claimed()
    const [claim] = (await queueEntry(agent.id))!.claims
    const corrected = email("corrected")
    expect(await confirmEmailClaim(await signedIn(MANAGER), claim.id, ` ${corrected.toUpperCase()} `)).toEqual({
      ok: true,
      data: { agentId: agent.id, email: corrected },
    })
    expect(await storedEmail(agent.id)).toBe(corrected)
    expect((await claimsOf(agent.id))[1]).toMatchObject({ outcome: "confirmed", email: corrected })
  })

  test("Reject is recorded and audited, and the agent leaves the queue", async () => {
    const { agent } = await claimed()
    const [claim] = (await queueEntry(agent.id))!.claims
    expect(await rejectEmailClaim(await signedIn(MANAGER), claim.id)).toEqual({ ok: true, data: { agentId: agent.id } })
    expect((await claimsOf(agent.id))[1]).toMatchObject({ claim_id: claim.id, outcome: "rejected", decided_by: MANAGER.id })
    expect(await storedEmail(agent.id)).toBeNull()
    expect(await queueEntry(agent.id)).toBeNull()
    expect(await stateOf(agent.id)).toBe("no_email")

    const audit = await db<{ actor_kind: string; actor_staff_id: string }>(
      `select actor_kind, actor_staff_id from public.audit_log
       where table_name = 'agent_email_claims' and new_values ->> 'claim_id' = $1`,
      [claim.id],
    )
    expect(audit).toEqual([{ actor_kind: "staff", actor_staff_id: MANAGER.id }])

    // A new claim after a rejection waits again.
    expect(await outcome({ phone: agent.phone, email: email("again"), hasCode: true, code: agent.code })).toMatchObject({ kind: "claimed" })
  })

  test("Confirm never overwrites an email the record got some other way", async () => {
    const { agent } = await claimed()
    const [claim] = (await queueEntry(agent.id))!.claims
    const manager = await signedIn(MANAGER)
    const meanwhile = email("meanwhile")
    expect((await setAgentEmail(manager, agent.id, meanwhile)).ok).toBe(true)

    expect(await confirmEmailClaim(manager, claim.id)).toEqual({ ok: false, error: { kind: "has-email" } })
    expect(await storedEmail(agent.id)).toBe(meanwhile)
  })

  test("Confirm refuses a switched-off agent", async () => {
    const { agent } = await claimed()
    const [claim] = (await queueEntry(agent.id))!.claims
    const manager = await signedIn(MANAGER)
    expect((await changeAgentStatus(manager, agent.id, "switch-off", "Testing claims")).ok).toBe(true)
    expect(await confirmEmailClaim(manager, claim.id)).toEqual({ ok: false, error: { kind: "switched-off" } })
    expect(await storedEmail(agent.id)).toBeNull()
  })

  test("a Pending agent with a claim waits in the queue but not under Approved, no account yet", async () => {
    const who = { fullName: `Pending Dai ${randomUUID().slice(0, 6)}`, phone: phone(), email: email("pending-claim") }
    const registered = await outcome(who)
    if (registered.kind !== "registered") throw new Error("expected a new agent")
    const [agent] = await agentsWithPhone(who.phone)
    // An old online sign-up with no email, as the three-argument form made them.
    await asSystem((sql) => sql.query("update public.marketing_agents set email = null where id = $1", [agent.id]))
    expect(await outcome({ ...who, email: email("claimer"), hasCode: true, code: registered.code })).toMatchObject({ kind: "claimed" })
    expect(await stateOf(agent.id)).toBe("awaiting_confirmation")
    const list = await listAgentsInAccountState(await signedIn(MANAGER), "no_account", { query: registered.code, page: 1 })
    expect(list.ok && list.data.agents.map((a) => a.id)).toEqual([])
  })

  test("Confirm refuses a staff member's email without naming them", async () => {
    const { agent } = await claimed()
    const [claim] = (await queueEntry(agent.id))!.claims
    expect(await confirmEmailClaim(await signedIn(MANAGER), claim.id, MANAGER.email)).toEqual({
      ok: false,
      error: { kind: "email-taken", email: MANAGER.email, agent: null },
    })
    expect(await storedEmail(agent.id)).toBeNull()
  })

  test("Confirm sends no name for the Super Admin's email, and names another agent holding one", async () => {
    const { agent } = await claimed()
    const [claim] = (await queueEntry(agent.id))!.claims
    const manager = await signedIn(MANAGER)
    const decide = (address: string) => manager.rpc("decide_agent_email_claim", { claim_id: claim.id, decision: "confirm", email: address })

    const hidden = await decide(SUPER_ADMIN.email)
    expect(hidden.error?.message).toBe("email_taken")
    expect(JSON.parse(hidden.error?.details ?? "{}")).toEqual({ email: SUPER_ADMIN.email })

    const otherAddress = email("claim-other")
    const other = await createAgent(manager, { fullName: `Other Dai ${randomUUID().slice(0, 6)}`, phone: phone(), email: otherAddress })
    if (!other.ok || other.data.kind !== "created") throw new Error(JSON.stringify(other))
    const named = await decide(otherAddress)
    expect(named.error?.message).toBe("email_taken")
    expect(JSON.parse(named.error?.details ?? "{}")).toEqual({
      email: otherAddress,
      holder: "agent",
      name: other.data.agent.fullName,
      code: other.data.agent.code,
    })
    expect(await storedEmail(agent.id)).toBeNull()
  })

  test("only approvers decide; claims refuse updates and deletes", async () => {
    const { agent } = await claimed()
    const [claim] = (await queueEntry(agent.id))!.claims
    expect(await confirmEmailClaim(await signedIn(ADMISSIONS), claim.id)).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await getEmailClaimQueue(await signedIn(ADMISSIONS))).toMatchObject({ ok: true })

    await expect(
      asSystem((sql) => sql.query("update public.agent_email_claims set email = 'x@example.test' where id = $1", [claim.id])),
    ).rejects.toThrow("update_refused")
    await expect(asSystem((sql) => sql.query("delete from public.agent_email_claims where id = $1", [claim.id]))).rejects.toThrow()
  })
})
