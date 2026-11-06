import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  accountBadge,
  approvedWithInvite,
  emailOutcome,
  inviteLine,
  inviteOutcome,
  needsAttention,
} from "@/app/staff/agents/invite-outcome"
import { ACCOUNT_STATES, type AccountCounts } from "@/lib/services/agent-invites"

const AGENT = { fullName: "Neema Juma", code: "NEEMA-01" }

function counts(overrides: Partial<AccountCounts> = {}): AccountCounts {
  return { ...(Object.fromEntries(ACCOUNT_STATES.map((state) => [state, 0])) as AccountCounts), ...overrides }
}

describe("the account-state badge", () => {
  it("says sent, never delivered", () => {
    for (const state of ACCOUNT_STATES) {
      expect(accountBadge(state).label.toLowerCase()).not.toContain("deliver")
    }
    expect(accountBadge("invited").label).toBe("Invite sent")
  })

  it("names every state the Agents screen shows", () => {
    expect(accountBadge("no_email").label).toBe("No email")
    expect(accountBadge("invite_not_sent").label).toBe("Invite not sent")
    expect(accountBadge("invite_expired").label).toBe("Invited, link expired")
    expect(accountBadge("joined").label).toBe("Joined")
    expect(accountBadge("awaiting_confirmation").label).toBe("Awaiting email confirmation")
  })

  it("marks the states that need attention", () => {
    expect(accountBadge("invite_not_sent").attention).toBe(true)
    expect(accountBadge("invite_expired").attention).toBe(true)
    expect(accountBadge("invited").attention).toBe(false)
    expect(accountBadge("joined").attention).toBe(false)
  })
})

describe("the line under the badge", () => {
  it("gives when the invite was sent, in East Africa Time", () => {
    expect(
      inviteLine({ email: "neema@example.test", state: "invited", sentAt: "2026-11-05T11:00:00Z", lastAttempt: null, joined: false }),
    ).toBe("Sent 5 Nov 2026, 14:00 to neema@example.test")
  })

  it("doesn't name the recipient for a joined agent, whose email may have changed since", () => {
    expect(
      inviteLine({ email: "new@example.test", state: "joined", sentAt: "2026-11-05T11:00:00Z", lastAttempt: null, joined: true }),
    ).toBe("Sent 5 Nov 2026, 14:00")
  })

  it("gives the reason when the latest attempt failed", () => {
    expect(
      inviteLine({
        email: "neema@example.test",
        state: "invite_not_sent",
        sentAt: null,
        lastAttempt: { result: "rate_limited", errorCode: null, at: "2026-11-05T11:00:00Z" },
        joined: false,
      }),
    ).toBe("Not sent 5 Nov 2026, 14:00: the hourly email limit is reached")
  })

  it("gives the code of an other error", () => {
    expect(
      inviteLine({
        email: "neema@example.test",
        state: "invite_not_sent",
        sentAt: null,
        lastAttempt: { result: "other_error", errorCode: "unexpected_failure", at: "2026-11-05T11:00:00Z" },
        joined: false,
      }),
    ).toBe("Not sent 5 Nov 2026, 14:00: email error unexpected_failure")
  })

  it("is empty when nothing was tried", () => {
    expect(inviteLine({ email: "neema@example.test", state: "invite_not_sent", sentAt: null, lastAttempt: null, joined: false })).toBeNull()
  })
})

describe("sending an invite", () => {
  it("says where it went, or that it was resent", () => {
    expect(inviteOutcome({ ok: true, data: { email: "neema@example.test", resend: false } })).toEqual({
      status: "sent",
      message: "Invite sent to neema@example.test.",
    })
    expect(inviteOutcome({ ok: true, data: { email: "neema@example.test", resend: true } })).toEqual({
      status: "sent",
      message: "Invite sent again to neema@example.test.",
    })
  })

  it("says why it wasn't sent", () => {
    expect(inviteOutcome({ ok: false, error: { kind: "rate-limited" } }).message).toBe(
      "Invite not sent: the hourly email limit is reached. Resend later.",
    )
    expect(inviteOutcome({ ok: false, error: { kind: "access-off" } }).message).toBe(
      "Invite not sent: agent access is off (access_off). Turn it on first.",
    )
    expect(inviteOutcome({ ok: false, error: { kind: "other-error", code: "boom" } }).message).toBe(
      "Invite not sent: email error boom. Resend in a moment.",
    )
  })
})

describe("approving with the invite", () => {
  it("says the invite went", () => {
    expect(approvedWithInvite(AGENT, { ok: true, data: { email: "neema@example.test", resend: false } })).toEqual({
      status: "approved",
      message: "Neema Juma (NEEMA-01) is Approved. Invite sent to neema@example.test.",
      inviteSent: true,
    })
  })

  it("still approves when the email fails, and says why", () => {
    expect(approvedWithInvite(AGENT, { ok: false, error: { kind: "smtp-error" } })).toEqual({
      status: "approved",
      message: "Approved. Invite not sent: the email service refused it. Resend in a moment.",
      inviteSent: false,
    })
  })

  it("says nothing about an invite for an agent with no email", () => {
    expect(approvedWithInvite(AGENT, { ok: false, error: { kind: "no-email" } })).toEqual({
      status: "approved",
      message: "Neema Juma (NEEMA-01) is Approved. Add their email to send the invite.",
      inviteSent: false,
    })
  })
})

describe("editing an email", () => {
  it("says whose the address is when it is taken", () => {
    expect(emailOutcome({ ok: false, error: { kind: "email-taken", holder: "staff", name: "Asha Staff", code: null } }).message).toBe(
      "This email belongs to staff member Asha Staff. Staff and agents can't share an email.",
    )
    expect(
      emailOutcome({ ok: false, error: { kind: "email-taken", holder: "agent", name: "Juma Agent", code: "JUMA-02" } }).message,
    ).toBe("This email belongs to agent Juma Agent (JUMA-02).")
    expect(emailOutcome({ ok: false, error: { kind: "email-taken", holder: "login", name: null, code: null } }).message).toBe(
      "This email is already used by another sign-in.",
    )
  })

  it("asks for the invite once the email is saved", () => {
    expect(emailOutcome({ ok: true, data: { email: "new@example.test", previousEmail: null } })).toEqual({
      status: "saved",
      message: "Email saved. Send the invite when you're ready.",
    })
  })

  it("says only the agent can change a joined agent's email (owner decision 41)", () => {
    expect(emailOutcome({ ok: false, error: { kind: "already-joined" } })).toEqual({
      status: "refused",
      message: "They have already set a password. Only the agent can change this now.",
    })
  })
})

describe("needs attention", () => {
  it("is the sum of the named counts, with a breakdown", () => {
    expect(needsAttention(counts({ invite_not_sent: 3, invite_expired: 2, invited: 9, joined: 4 }))).toEqual({
      total: 5,
      parts: [
        { state: "invite_not_sent", label: "invite not sent", count: 3 },
        { state: "invite_expired", label: "link expired", count: 2 },
      ],
    })
  })

  it("counts agents awaiting email confirmation once that state exists", () => {
    expect(needsAttention(counts({ awaiting_confirmation: 1 })).total).toBe(1)
  })
})
