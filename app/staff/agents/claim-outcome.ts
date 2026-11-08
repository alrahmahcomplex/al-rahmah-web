import { emailTakenMessage } from "@/lib/email-in-use"
import type { ClaimDecisionError } from "@/lib/services/agent-email-claims"
import type { AgentInviteError, SentInvite } from "@/lib/services/agent-invites"
import type { Result } from "@/lib/services/result"

import { inviteOutcome } from "./invite-outcome"

// The Agents screen's words for the "Awaiting email confirmation" queue
// (#193). Confirming stands whatever the invite email does, as approving
// does: a failed send reads "Invite not sent", and Resend is on the row.

export type ClaimOutcome = { status: "done"; message: string } | { status: "refused"; message: string }

const REFUSALS: Record<Exclude<ClaimDecisionError["kind"], "email-taken">, string> = {
  forbidden: "You don't have permission to decide email claims.",
  "not-found": "This claim could not be found. Reload the page.",
  "already-decided": "This claim was already decided. Reload the page.",
  retired: "This agent is retired, so nothing about them can change.",
  "switched-off": "This agent is switched off. Switch them on first.",
  "has-email": "This agent already has an email, which a claim never replaces. Reload the page.",
  "already-joined": "They have already set a password. Only the agent can change this now.",
  "email-invalid": "Enter a valid email address.",
  unavailable: "Something went wrong. Try again in a moment.",
}

export function claimRefusal(error: ClaimDecisionError | { kind: "signed-out" }): string {
  if (error.kind === "signed-out") return "Your session has ended. Sign in again, then try again."
  if (error.kind !== "email-taken") return REFUSALS[error.kind]
  return emailTakenMessage(error)
}

// After Confirm or Save and send invite: the email is saved; say how the
// invite went.
export function confirmedOutcome(
  agent: { fullName: string },
  email: string,
  invite: Result<SentInvite, AgentInviteError | { kind: "signed-out" }>,
): ClaimOutcome {
  const saved = `Email confirmed for ${agent.fullName}.`
  if (invite.ok) return { status: "done", message: `${saved} Invite sent to ${email}.` }
  if (!invite.ok && invite.error.kind === "not-approved") {
    return { status: "done", message: `${saved} Approve them to send the invite.` }
  }
  return { status: "done", message: `${saved} ${inviteOutcome(invite).message}` }
}
