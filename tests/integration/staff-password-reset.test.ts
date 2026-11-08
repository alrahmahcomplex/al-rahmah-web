import { createHash, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { AgentInviteSender } from "@/lib/services/agent-invites"
import { decidePasswordLink, sendPasswordLink, type LinkLimits, type LinkToSend } from "@/lib/services/password-link-requests"
import { sendResetLink, type SendInvite } from "@/lib/services/staff-admin"

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inRolledBackTransaction,
  lockExclusively,
  secretClient,
  signedIn,
} from "../support/db"
import { DEACTIVATED, INVITED, MANAGER, SEEDED_AGENT, SUPER_ADMIN } from "../support/fixtures"

// Staff password resets (#265) against local Supabase: the public request
// for staff, and a Manager's "Send reset link". Every staff member a test
// changes is its own throwaway, with an example.test email.

const OPEN: LinkLimits = { perEmailLimit: 1_000, hourlyBudget: 1_000_000 }
const RESET_URL = "http://localhost:3100/login/reset-password"
const REDIRECTS = {
  agent: { reset: RESET_URL, invite: "http://localhost:3100/discount-code/set-password" },
  staff: { reset: RESET_URL, invite: "http://localhost:3100/auth/confirm" },
}

function hashOf(address: string) {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex")
}

async function admissionsStaffRoleId() {
  return asSystem(async (sql) => {
    const { rows } = await sql.query<{ id: string }>("select role_id as id from public.staff_members where id = $1", [INVITED.id])
    return rows[0].id
  })
}

// A joined staff member on Admissions Staff, which the seeded Manager manages.
async function joinedStaff() {
  return createThrowawayStaff([], { onRole: await admissionsStaffRoleId() })
}

// An active staff member with no login yet, as the invite leaves them.
async function invitedStaff() {
  const roleId = await admissionsStaffRoleId()
  const address = `invited-${randomUUID().slice(0, 8)}@example.test`
  const id = await asSystem(async (sql) => {
    const { rows } = await sql.query<{ id: string }>(
      "insert into public.staff_members (full_name, email, role_id) values ($1, $2, $3) returning id",
      [`Invited ${address.slice(8, 16)}`, address, roleId],
    )
    return rows[0].id
  })
  return { id, email: address }
}

async function deactivatedStaff() {
  const member = await joinedStaff()
  await asSystem((sql) => sql.query("update public.staff_members set active = false where id = $1", [member.id]))
  return member
}

async function request(sql: Client, address: string, perEmailLimit = 1_000, hourlyBudget = 1_000_000) {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })])
  const { rows } = await sql.query<{ outcome: string; principal: string | null; send_to: string | null; attempt_id: string | null }>(
    "select * from public.request_password_link($1, $2, $3)",
    [address, perEmailLimit, hourlyBudget],
  )
  return rows[0]
}

describe("the public request, for staff", () => {
  test("an active staff member who has joined gets a reset to the shared reset page, with no agent attempt", async () => {
    const member = await joinedStaff()
    const decided = await decidePasswordLink(secretClient(), ` ${member.email.toUpperCase()} `, OPEN)
    expect(decided).toEqual({ ok: true, data: { kind: "reset", principal: "staff", email: member.email, attemptId: null } })

    const staffReset = vi.fn<AgentInviteSender>(async () => ({ error: null }))
    const unused = vi.fn<AgentInviteSender>(async () => ({ error: null }))
    const sent = await sendPasswordLink(
      secretClient(),
      { staff: { reset: staffReset, invite: unused }, agent: { reset: unused, invite: unused } },
      REDIRECTS,
      (decided as { data: LinkToSend }).data,
    )
    expect(sent).toEqual({ ok: true, data: null })
    expect(staffReset).toHaveBeenCalledWith(member.email, RESET_URL)
    expect(unused).not.toHaveBeenCalled()
  })

  test("an active staff member still Invited gets a fresh staff invite", async () => {
    const member = await invitedStaff()
    await inRolledBackTransaction(async (sql) => {
      expect(await request(sql, member.email)).toEqual({ outcome: "invite", principal: "staff", send_to: member.email, attempt_id: null })
    })
    // The seeded Invited staff member too, who has no login at all.
    await inRolledBackTransaction(async (sql) => {
      expect((await request(sql, INVITED.email)).outcome).toBe("invite")
    })
  })

  test("the Super Admin resets like anyone else", async () => {
    await inRolledBackTransaction(async (sql) => {
      expect(await request(sql, SUPER_ADMIN.email)).toEqual({
        outcome: "reset",
        principal: "staff",
        send_to: SUPER_ADMIN.email,
        attempt_id: null,
      })
    })
  })

  test.each([
    ["a deactivated staff member", async () => (await deactivatedStaff()).email],
    ["the seeded deactivated staff member", async () => DEACTIVATED.email],
    ["an email nobody uses", async () => `stranger-${randomUUID().slice(0, 8)}@example.test`],
  ])("%s gets nothing, and the request still counts", async (_label, address) => {
    const typed = await address()
    await inRolledBackTransaction(async (sql) => {
      expect(await request(sql, typed)).toEqual({ outcome: "none", principal: null, send_to: null, attempt_id: null })
      const { rows } = await sql.query("select 1 from public.agent_link_requests where email_hash = $1", [hashOf(typed)])
      expect(rows).toHaveLength(1)
    })
  })

  test("staff resets work while agent access is off", async () => {
    const member = await joinedStaff()
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_access(false)")
      expect((await request(sql, member.email)).outcome).toBe("reset")
    })
  })

  test("staff share the per-email limit", async () => {
    const member = await joinedStaff()
    await inRolledBackTransaction(async (sql) => {
      await sql.query(
        "insert into public.agent_link_requests (email_hash, requested_at) values ($1, now() - interval '5 minutes'), ($1, now() - interval '3 minutes')",
        [hashOf(member.email)],
      )
      expect((await request(sql, member.email, 2)).outcome).toBe("limited")
    })
    await inRolledBackTransaction(async (sql) => {
      await sql.query(
        "insert into public.agent_link_requests (email_hash, requested_at) values ($1, now() - interval '5 minutes'), ($1, now() - interval '3 minutes')",
        [hashOf(member.email)],
      )
      expect((await request(sql, member.email, 3)).outcome).toBe("reset")
    })
  })

  test("staff and agents share the hourly budget", async () => {
    const member = await joinedStaff()
    await inRolledBackTransaction(async (sql) => {
      await lockExclusively(sql, ["public.agent_link_requests"])
      await sql.query("delete from public.agent_link_requests where requested_at < now() - interval '1 hour'")
      const { rows } = await sql.query<{ n: number }>("select count(*)::int as n from public.agent_link_requests")
      const used = rows[0].n

      expect((await request(sql, member.email, 1_000, used)).outcome).toBe("busy")
      // An agent's request takes the last place, and the staff member is then refused.
      expect((await request(sql, SEEDED_AGENT.email, 1_000, used + 1)).outcome).not.toBe("busy")
      expect((await request(sql, member.email, 1_000, used + 1)).outcome).toBe("busy")
    })
  })
})

// ---------------------------------------------------------------------------
// The Manager's "Send reset link"
// ---------------------------------------------------------------------------

function sender() {
  return vi.fn<SendInvite>(async () => ({ error: null }))
}

async function resetEvents(staffId: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ actor_staff_id: string; new_values: Record<string, unknown>; scope: string }>(
      "select actor_staff_id, new_values, scope from public.audit_log where action = 'password_reset_sent' and new_values->>'staff_member_id' = $1",
      [staffId],
    )
    return rows
  })
}

describe("Send reset link", () => {
  test("a Manager sends one to a joined staff member in their Managed set, recorded as an Action event and counted", async () => {
    const member = await joinedStaff()
    const send = sender()
    const sent = await sendResetLink(await signedIn(MANAGER), send, member.id, 1_000_000, RESET_URL)

    expect(sent).toEqual({ ok: true, data: expect.objectContaining({ id: member.id, email: member.email, name: member.name }) })
    expect(send).toHaveBeenCalledWith(member.email, RESET_URL)
    expect(await resetEvents(member.id)).toEqual([
      { actor_staff_id: MANAGER.id, new_values: { staff_member_id: member.id, email: member.email }, scope: "staff_admin" },
    ])
    const counted = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query("select 1 from public.agent_link_requests where email_hash = $1", [hashOf(member.email)])
      return rows.length
    })
    expect(counted).toBe(1)
  })

  test("the Super Admin sends to anyone, outside every Manager's set too", async () => {
    const member = await createThrowawayStaff([])
    const send = sender()
    expect((await sendResetLink(await signedIn(SUPER_ADMIN), send, member.id, 1_000_000, RESET_URL)).ok).toBe(true)
    expect(send).toHaveBeenCalledOnce()
    expect(await resetEvents(member.id)).toHaveLength(1)
  })

  test.each([
    ["outside the Managed set", async () => (await createThrowawayStaff([])).id, "forbidden"],
    ["deactivated", async () => DEACTIVATED.id, "reset_deactivated"],
    ["still Invited", async () => INVITED.id, "reset_not_joined"],
    ["the hidden Super Admin", async () => SUPER_ADMIN.id, "not_found"],
  ])("is refused in the database for someone %s, and nothing is sent or recorded", async (_label, target, code) => {
    const staffId = await target()
    const send = sender()
    // Straight to the database, as a caller skipping the screen would.
    const direct = await (await signedIn(MANAGER)).rpc("prepare_staff_reset", { staff_id: staffId, hourly_budget: 1_000_000 })
    expect(direct.error?.message).toBe(code)

    const sent = await sendResetLink(await signedIn(MANAGER), send, staffId, 1_000_000, RESET_URL)
    expect(sent).toEqual({ ok: false, error: expect.objectContaining({ code }) })
    expect(send).not.toHaveBeenCalled()
    expect(await resetEvents(staffId)).toEqual([])
  })

  test("a staff member who manages nobody is refused", async () => {
    const member = await joinedStaff()
    const plain = await joinedStaff()
    const refused = await (await signedIn(plain)).rpc("prepare_staff_reset", { staff_id: member.id, hourly_budget: 1_000_000 })
    expect(refused.error?.message).toBe("not_permitted")
  })

  test("the hourly budget refuses it with the rate-limit message, and nothing is sent", async () => {
    const member = await joinedStaff()
    const send = sender()
    const sent = await sendResetLink(await signedIn(MANAGER), send, member.id, 0, RESET_URL)
    expect(sent).toEqual({
      ok: false,
      error: { code: "reset_rate_limited", message: "Too many emails have gone out in the last hour. Try sending the reset link later." },
    })
    expect(send).not.toHaveBeenCalled()
    expect(await resetEvents(member.id)).toEqual([])
  })

  test("Supabase's own email limit shows the same message; any other failure says the email wasn't sent", async () => {
    const member = await joinedStaff()
    const limited = vi.fn<SendInvite>(async () => ({ error: { message: "Too many", status: 429, code: "over_email_send_rate_limit" } }))
    const manager = await signedIn(MANAGER)
    expect(await sendResetLink(manager, limited, member.id, 1_000_000, RESET_URL)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "reset_rate_limited" }),
    })

    const broken = vi.fn<SendInvite>(async () => ({ error: { message: "SMTP down", status: 500, code: "unexpected_failure" } }))
    expect(await sendResetLink(manager, broken, member.id, 1_000_000, RESET_URL)).toEqual({
      ok: false,
      error: { code: "reset_not_sent", message: "The reset email could not be sent." },
    })
  })

  test("a visitor and the seeded agent can't call it", async () => {
    const member = await joinedStaff()
    for (const client of [anonClient(), await signedIn(SEEDED_AGENT)]) {
      const refused = await client.rpc("prepare_staff_reset", { staff_id: member.id, hourly_budget: 1_000_000 })
      expect(`${refused.error?.code} ${refused.error?.message}`).toMatch(/42501|PGRST202|not_permitted/)
    }
  })
})
