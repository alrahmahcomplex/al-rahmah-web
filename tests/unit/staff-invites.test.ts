import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { inviteStaff, resendInvite, type SendInvite } from "@/lib/services/staff-admin"

// A stand-in for the two doors the invite service uses: the caller's session
// (rpc, answering per database function) and the secret-key invite sender.
// Every call lands in one log, so the tests can check the order.

type RpcAnswer = { data?: unknown; error?: { message: string; details?: string | null } | null }
type SendAnswer = Awaited<ReturnType<SendInvite>>

const REDIRECT = "https://school.example/auth/confirm"
const INVITED = { id: "staff-9", name: "Zawadi Mrisho", role: "Admissions Staff", email: "zawadi@example.test" }

function fakes(answers: Record<string, RpcAnswer> = {}, sendAnswers: SendAnswer[] = [{ error: null }]) {
  const log: string[] = []
  const rpcArgs: Record<string, unknown> = {}
  const defaults: Record<string, RpcAnswer> = {
    has_permission: { data: true },
    invite_staff_member: { data: INVITED },
    resendable_invite: { data: INVITED },
    record_action: { data: 1 },
  }
  const rpc = vi.fn(async (fn: string, args: unknown) => {
    log.push(fn)
    rpcArgs[fn] = args
    const answer = answers[fn] ?? defaults[fn]
    return { data: answer?.data ?? null, error: answer?.error ?? null }
  })
  const send = vi.fn<SendInvite>(async () => {
    log.push("send")
    return sendAnswers.shift() ?? { error: null }
  })
  return { client: { rpc } as unknown as SupabaseClient, send, log, rpcArgs }
}

const details = { fullName: "Zawadi Mrisho", email: "zawadi@example.test", roleId: "role-1" }

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("inviteStaff", () => {
  it("checks the permission, creates the record, sends the invite, then records invite_sent", async () => {
    const { client, send, log, rpcArgs } = fakes()

    const result = await inviteStaff(client, send, details, REDIRECT)

    expect(result).toEqual({ ok: true, data: { ...INVITED, sent: true } })
    expect(log).toEqual(["has_permission", "invite_staff_member", "send", "record_action"])
    expect(rpcArgs.has_permission).toEqual({ permission: "staff.administer" })
    expect(rpcArgs.invite_staff_member).toEqual({ full_name: "Zawadi Mrisho", email: "zawadi@example.test", role_id: "role-1" })
    expect(send).toHaveBeenCalledWith("zawadi@example.test", REDIRECT)
    expect(rpcArgs.record_action).toEqual({
      kind: "invite_sent",
      lead_id: null,
      details: { staff_member_id: "staff-9", email: "zawadi@example.test" },
    })
  })

  it("stops before anything else when the caller cannot administer staff", async () => {
    const { client, send, log } = fakes({ has_permission: { data: false } })

    const result = await inviteStaff(client, send, details, REDIRECT)

    expect(result).toEqual({
      ok: false,
      error: { code: "not_permitted", message: `Your role doesn't include "Administer staff and roles".` },
    })
    expect(log).toEqual(["has_permission"])
  })

  it("fails closed when the permission check can't run", async () => {
    const { client, send, log } = fakes({ has_permission: { error: { message: "fetch failed" } } })

    const result = await inviteStaff(client, send, details, REDIRECT)

    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } })
    expect(log).toEqual(["has_permission"])
  })

  it("sends nothing when the database refuses the record", async () => {
    const { client, send, log } = fakes({
      invite_staff_member: {
        error: {
          message: "already_staff",
          details: JSON.stringify({ email: "amina@example.test", name: "Amina Juma", active: false }),
        },
      },
    })

    const result = await inviteStaff(client, send, details, REDIRECT)

    expect(result).toEqual({
      ok: false,
      error: {
        code: "already_staff",
        message: "amina@example.test already belongs to Amina Juma. Reactivate them instead of inviting again.",
      },
    })
    expect(log).toEqual(["has_permission", "invite_staff_member"])
  })

  it("says an active staff member already holds the email without asking to reactivate them", async () => {
    const { client, send } = fakes({
      invite_staff_member: {
        error: {
          message: "already_staff",
          details: JSON.stringify({ email: "amina@example.test", name: "Amina Juma", active: true }),
        },
      },
    })

    const result = await inviteStaff(client, send, details, REDIRECT)

    expect(result).toMatchObject({ ok: false, error: { message: "amina@example.test already belongs to Amina Juma." } })
  })

  it("keeps the record and reports the failure when the email can't be sent, recording no invite", async () => {
    const { client, send, log } = fakes({}, [{ error: { message: "Error sending invite email", status: 500 } }])

    const result = await inviteStaff(client, send, details, REDIRECT)

    expect(result).toEqual({
      ok: true,
      data: {
        ...INVITED,
        sent: false,
        failure: { code: "invite_not_sent", message: "The invite email could not be sent." },
      },
    })
    expect(log).toEqual(["has_permission", "invite_staff_member", "send"])
  })

  it("reports the hourly email limit in words", async () => {
    const { client, send } = fakes({}, [
      { error: { message: "Email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" } },
    ])

    const result = await inviteStaff(client, send, details, REDIRECT)

    expect(result).toMatchObject({
      ok: true,
      data: { sent: false, failure: { code: "invite_rate_limited" } },
    })
  })

  it("still reports a sent invite when recording it fails, and says so in the log", async () => {
    const { client, send } = fakes({ record_action: { error: { message: "fetch failed" } } })

    const result = await inviteStaff(client, send, details, REDIRECT)

    expect(result).toMatchObject({ ok: true, data: { sent: true } })
    expect(console.error).toHaveBeenCalled()
  })
})

describe("resendInvite", () => {
  it("checks the permission, looks up the Invited member, sends again, then records invite_sent", async () => {
    const { client, send, log, rpcArgs } = fakes()

    const result = await resendInvite(client, send, "staff-9", REDIRECT)

    expect(result).toEqual({ ok: true, data: INVITED })
    expect(log).toEqual(["has_permission", "resendable_invite", "send", "record_action"])
    expect(rpcArgs.resendable_invite).toEqual({ staff_id: "staff-9" })
    expect(send).toHaveBeenCalledWith("zawadi@example.test", REDIRECT)
  })

  it("sends nothing when the caller cannot administer staff", async () => {
    const { client, send, log } = fakes({ has_permission: { data: false } })

    expect(await resendInvite(client, send, "staff-9", REDIRECT)).toMatchObject({
      ok: false,
      error: { code: "not_permitted" },
    })
    expect(log).toEqual(["has_permission"])
  })

  it("reports email_exists as already joined", async () => {
    const { client, send, log } = fakes({}, [
      { error: { message: "A user with this email address has already been registered", status: 422, code: "email_exists" } },
    ])

    expect(await resendInvite(client, send, "staff-9", REDIRECT)).toEqual({
      ok: false,
      error: { code: "already_joined", message: "Zawadi Mrisho has already joined and signs in with their own password." },
    })
    expect(log).not.toContain("record_action")
  })

  it("passes on the database's refusal for a deactivated member", async () => {
    const { client, send, log } = fakes({
      resendable_invite: { error: { message: "invite_deactivated", details: JSON.stringify({ name: "Zawadi Mrisho" }) } },
    })

    expect(await resendInvite(client, send, "staff-9", REDIRECT)).toEqual({
      ok: false,
      error: { code: "invite_deactivated", message: "Zawadi Mrisho is deactivated. Reactivate them before resending the invite." },
    })
    expect(log).toEqual(["has_permission", "resendable_invite"])
  })

  it("works after a failed first send", async () => {
    const { client, send } = fakes({}, [{ error: { message: "smtp down", status: 500 } }, { error: null }])

    const first = await inviteStaff(client, send, details, REDIRECT)
    const again = await resendInvite(client, send, "staff-9", REDIRECT)

    expect(first).toMatchObject({ ok: true, data: { sent: false } })
    expect(again).toEqual({ ok: true, data: INVITED })
  })
})
