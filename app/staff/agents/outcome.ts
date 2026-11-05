import type { AgentStatusAction, AgentStatusError, AgentStatusNote, ApproveAgentError } from "@/lib/services/marketing-agents"

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

// ---------------------------------------------------------------------------
// Switch off, Switch on and Retire (#187).
// ---------------------------------------------------------------------------

// The longest reason the database keeps (agent_status_changes.reason).
export const STATUS_REASON_MAX = 500

const ACTION_VERB: Record<AgentStatusAction, string> = {
  "switch-off": "Switch off",
  "switch-on": "Switch on",
  retire: "Retire",
}

const ACTION_DONE: Record<AgentStatusAction, string> = {
  "switch-off": "is switched off",
  "switch-on": "is switched on",
  retire: "is retired",
}

export function actionVerb(action: AgentStatusAction): string {
  return ACTION_VERB[action]
}

// What the action does, said before the Manager confirms.
export function actionEffect(action: AgentStatusAction, code: string): string {
  switch (action) {
    case "switch-off":
      return `Code ${code} stops giving the interview discount on every fee not yet Paid. Paid fees keep the amount paid. You can switch the agent back on.`
    case "switch-on":
      return `Code ${code} gives the interview discount again, if the agent is Approved, on every fee not yet Paid.`
    case "retire":
      return `Retiring is permanent. The record stays for history, code ${code} gives no discount, and the agent's phone is freed so they can be created again.`
  }
}

// "This changes the interview fee for N families not yet Paid."
export function feeImpactLine(count: number): string {
  return `This changes the interview fee for ${count} ${count === 1 ? "family" : "families"} not yet Paid.`
}

// The line staff and the Accountant read out to each family on the list. It
// names the code as families know it (Code ya Punguzo), never the agent, and
// the interview fee per child the change leaves.
export function familyLine(family: { feeNow: number; feeAfter: number }): string {
  const amount = `TZS ${family.feeAfter.toLocaleString("en-US")}`
  return family.feeAfter < family.feeNow
    ? `Code ya punguzo mliyotumia inatoa punguzo tena. Ada ya usaili sasa ni ${amount} kwa kila mtoto.`
    : `Code ya punguzo mliyotumia haitoi punguzo kwa sasa. Ada ya usaili sasa ni ${amount} kwa kila mtoto.`
}

// When the change may or may not have been saved: the request or its answer
// was lost, or the reply could not be read.
export const STATUS_LOST =
  "The change could not be confirmed. Check your connection, reload the page and see whether the agent's status changed."

export type StatusOutcome = { status: "changed"; message: string } | { status: "refused"; message: string }

const STATUS_REFUSED: Record<AgentStatusError | "signed-out", string> = {
  forbidden: "You don't have permission to change a Marketing Agent's status.",
  "not-found": "This agent could not be found. Reload the page and try again.",
  retired: "This agent is retired, so nothing about them can change.",
  "no-change": "Someone already made this change. Reload the page to see the agent as they are now.",
  "invalid-reason": `Write a reason, up to ${STATUS_REASON_MAX} characters.`,
  unavailable: "The change could not be saved just now. Nothing was changed. Try again in a moment.",
  uncertain: STATUS_LOST,
  "signed-out": "Your session has ended. Sign in again, then try again.",
}

export function statusOutcome(
  result: { ok: true; data: { feeChangeCount: number } } | { ok: false; error: AgentStatusError | "signed-out" },
  action: AgentStatusAction,
  agent: { fullName: string; code: string },
): StatusOutcome {
  if (!result.ok) return { status: "refused", message: STATUS_REFUSED[result.error] }
  const count = result.data.feeChangeCount
  const fees = count === 0 ? "No interview fee changed." : `${count} ${count === 1 ? "family's" : "families'"} interview fee changed.`
  return { status: "changed", message: `${agent.fullName} (${agent.code}) ${ACTION_DONE[action]}. ${fees}` }
}

// A day in East Africa Time, such as 4 Nov 2026.
const DAY = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Dar_es_Salaam" })

// The line under a retired or switched-off agent's status: "Retired by
// [name] on [date], replaced by [record]", the replacement only once a
// Recreate names one. Null for an agent who is neither.
export function statusChangeLine(agent: {
  retiredAt: string | null
  switchedOffAt: string | null
  statusChange: AgentStatusNote | null
}): string | null {
  const note = agent.statusChange
  const when = agent.retiredAt ?? agent.switchedOffAt
  if (!when) return null
  const by = note?.changedBy ? ` by ${note.changedBy}` : ""
  const on = ` on ${DAY.format(new Date(when))}`
  if (!agent.retiredAt) return `Switched off${by}${on}`
  const replaced = note?.replacedBy ? `, replaced by ${note.replacedBy.fullName} (${note.replacedBy.code})` : ""
  return `Retired${by}${on}${replaced}`
}
