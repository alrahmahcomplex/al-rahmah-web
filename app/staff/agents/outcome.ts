import type { ApproveAgentError } from "@/lib/services/marketing-agents"

// What the Approve dialog is told after it asks.
export type ApproveOutcome = { status: "approved"; message: string } | { status: "refused"; message: string }

const REFUSED: Record<ApproveAgentError | "signed-out", string> = {
  forbidden: "You don't have permission to approve Marketing Agents.",
  "not-found": "This agent could not be found. Reload the page and try again.",
  "no-change": "This agent is already Approved. Reload the page to see who approved them.",
  unavailable: "The agent could not be approved just now. Try again in a moment.",
  "signed-out": "Your session has ended. Sign in again, then approve the agent.",
}

export function approveOutcome(
  result: { ok: true } | { ok: false; error: ApproveAgentError | "signed-out" },
  agent: { fullName: string; code: string },
): ApproveOutcome {
  if (result.ok) return { status: "approved", message: `${agent.fullName} (${agent.code}) is Approved.` }
  return { status: "refused", message: REFUSED[result.error] }
}
