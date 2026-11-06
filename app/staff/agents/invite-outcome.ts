import type {
  AccountCounts,
  AccountState,
  AgentInviteError,
  AgentInviteNote,
  EmailChange,
  SentInvite,
  SetEmailError,
} from "@/lib/services/agent-invites"
import type { Result } from "@/lib/services/result"

import { ACCESS_OFF_CODE } from "./access-banner"

// The Agents screen's words for invites, account states and email edits
// (#191). An invite is "sent" once Auth accepts it; whether it reached the
// inbox is never known, so nothing here says "delivered".

const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

const BADGES: Record<AccountState, { label: string; attention: boolean }> = {
  retired: { label: "Retired", attention: false },
  switched_off: { label: "Switched off", attention: false },
  awaiting_confirmation: { label: "Awaiting email confirmation", attention: true },
  no_email: { label: "No email", attention: false },
  invite_not_sent: { label: "Invite not sent", attention: true },
  invite_expired: { label: "Invited, link expired", attention: true },
  invited: { label: "Invite sent", attention: false },
  joined: { label: "Joined", attention: false },
}

export function accountBadge(state: AccountState): { label: string; attention: boolean } {
  return BADGES[state]
}

// Why an invite email didn't go, as the end of "Invite not sent: …".
const SEND_REASONS: Record<string, string> = {
  rate_limited: "the hourly email limit is reached",
  smtp_error: "the email service refused it",
  rejected_address: "the address was refused",
  access_off: `agent access is off (${ACCESS_OFF_CODE})`,
}

function sendReason(result: string, errorCode: string | null): string {
  if (result === "other_error") return `email error ${errorCode ?? "unknown"}`
  return SEND_REASONS[result] ?? `email error ${result}`
}

// The line under the badge: when the invite to the current email was sent,
// or why the latest attempt failed.
export function inviteLine(note: AgentInviteNote): string | null {
  const last = note.lastAttempt
  if (last && last.result !== "sent") {
    return `Not sent ${WHEN.format(new Date(last.at))}: ${sendReason(last.result, last.errorCode)}`
  }
  // A joined agent's email may since have changed in Auth, so the line
  // doesn't name it as the invite's recipient.
  if (note.sentAt) return `Sent ${WHEN.format(new Date(note.sentAt))}${note.email && !note.joined ? ` to ${note.email}` : ""}`
  return null
}

const NEXT_STEP: Partial<Record<AgentInviteError["kind"], string>> = {
  "rate-limited": "Resend later.",
  "smtp-error": "Resend in a moment.",
  "rejected-address": "Check the email, then resend.",
  "other-error": "Resend in a moment.",
  "access-off": "Turn it on first.",
}

const REFUSALS: Record<Exclude<AgentInviteError["kind"], "rate-limited" | "smtp-error" | "rejected-address" | "other-error" | "access-off">, string> = {
  forbidden: "you don't have permission to send invites",
  "not-found": "this agent could not be found. Reload the page",
  retired: "this agent is retired",
  "switched-off": "this agent is switched off",
  "not-approved": "this agent isn't Approved yet",
  "no-email": "there is no email. Add one first",
  "already-joined": "they have already set a password",
  "email-changed": "the email changed since this page loaded. Reload the page and check it",
  "recently-invited": "they were sent an invite in the last 24 hours",
  "batch-closed": "the invite batch has finished. Reload the page",
  unavailable: "something went wrong. Try again in a moment",
}

function failureReason(error: AgentInviteError | { kind: "signed-out" }): string {
  switch (error.kind) {
    case "signed-out":
      return "your session has ended. Sign in again, then resend."
    case "rate-limited":
      return `${SEND_REASONS.rate_limited}. ${NEXT_STEP["rate-limited"]}`
    case "smtp-error":
      return `${SEND_REASONS.smtp_error}. ${NEXT_STEP["smtp-error"]}`
    case "rejected-address":
      return `${SEND_REASONS.rejected_address}. ${NEXT_STEP["rejected-address"]}`
    case "other-error":
      return `email error ${error.code}. ${NEXT_STEP["other-error"]}`
    case "access-off":
      return `${SEND_REASONS.access_off}. ${NEXT_STEP["access-off"]}`
    default:
      return `${REFUSALS[error.kind]}.`
  }
}

export type InviteOutcome = { status: "sent"; message: string } | { status: "refused"; message: string }

export function inviteOutcome(result: Result<SentInvite, AgentInviteError | { kind: "signed-out" }>): InviteOutcome {
  if (result.ok) {
    return {
      status: "sent",
      message: `Invite sent ${result.data.resend ? "again " : ""}to ${result.data.email}.`,
    }
  }
  return { status: "refused", message: `Invite not sent: ${failureReason(result.error)}` }
}

export type ApprovedOutcome = { status: "approved"; message: string; inviteSent: boolean }

// Approving sends the invite to the email the Manager saw on the row.
// Approval stands whatever the email does.
export function approvedWithInvite(
  agent: { fullName: string; code: string },
  invite: Result<SentInvite, AgentInviteError | { kind: "signed-out" }>,
): ApprovedOutcome {
  const approved = `${agent.fullName} (${agent.code}) is Approved.`
  if (invite.ok) return { status: "approved", message: `${approved} Invite sent to ${invite.data.email}.`, inviteSent: true }
  if (invite.error.kind === "no-email") {
    return { status: "approved", message: `${approved} Add their email to send the invite.`, inviteSent: false }
  }
  return { status: "approved", message: `Approved. Invite not sent: ${failureReason(invite.error)}`, inviteSent: false }
}

export type EmailOutcome = { status: "saved"; message: string } | { status: "refused"; message: string }

const EMAIL_REFUSALS: Record<Exclude<SetEmailError["kind"], "email-taken">, string> = {
  forbidden: "You don't have permission to change an agent's email.",
  "not-found": "This agent could not be found. Reload the page and try again.",
  retired: "This agent is retired, so nothing about them can change.",
  "email-invalid": "Enter a valid email address.",
  "no-change": "That is already their email.",
  "already-joined": "They have already set a password. Only the agent can change this now.",
  unavailable: "The email couldn't be saved just now. Try again in a moment.",
}

export function emailOutcome(result: Result<EmailChange, SetEmailError | { kind: "signed-out" }>): EmailOutcome {
  if (result.ok) {
    return {
      status: "saved",
      message: "Email saved. Send the invite when you're ready.",
    }
  }
  const error = result.error
  if (error.kind === "signed-out") return { status: "refused", message: "Your session has ended. Sign in again, then try again." }
  if (error.kind !== "email-taken") return { status: "refused", message: EMAIL_REFUSALS[error.kind] }
  if (error.holder === "staff") {
    return {
      status: "refused",
      message: `This email belongs to staff member ${error.name ?? "on the staff list"}. Staff and agents can't share an email.`,
    }
  }
  if (error.holder === "agent" && error.name) {
    return { status: "refused", message: `This email belongs to agent ${error.name}${error.code ? ` (${error.code})` : ""}.` }
  }
  if (error.holder === "agent") return { status: "refused", message: "This email belongs to another agent." }
  return { status: "refused", message: "This email is already used by another sign-in." }
}

const ATTENTION_LABELS: { state: AccountState; label: string; always: boolean }[] = [
  { state: "awaiting_confirmation", label: "awaiting email confirmation", always: true },
  { state: "invite_not_sent", label: "invite not sent", always: true },
  { state: "invite_expired", label: "link expired", always: true },
]

// "Needs attention": the sum of the named counts, with the breakdown. Retired
// records are never in these states, so they never count.
export function needsAttention(counts: AccountCounts): {
  total: number
  parts: { state: AccountState; label: string; count: number }[]
} {
  const parts = ATTENTION_LABELS.filter(({ state, always }) => always || counts[state] > 0).map(({ state, label }) => ({
    state,
    label,
    count: counts[state],
  }))
  return { total: parts.reduce((sum, part) => sum + part.count, 0), parts }
}
