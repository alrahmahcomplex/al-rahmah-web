import { emailTakenMessage } from "@/lib/email-in-use"
import type {
  AgentDraftField,
  AgentRef,
  AgentStatusAction,
  AgentStatusError,
  AgentStatusNote,
  ApproveAgentError,
  CreateAgentError,
  RecreateError,
} from "@/lib/services/marketing-agents"

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

// ---------------------------------------------------------------------------
// Creating an agent, and Recreate (#189).
// ---------------------------------------------------------------------------

// Where the Manager opens an agent's record: the list, searched for the code.
export function agentRecordHref(code: string, retired = false): string {
  return `/staff/agents?${new URLSearchParams({ status: retired ? "retired" : "all", q: code }).toString()}`
}

// "This number already belongs to [name], [code], [status]".
export function phoneTakenLine(agent: AgentRef): string {
  return `This number already belongs to ${agent.fullName}, ${agent.code}, ${agent.state}`
}

export function codeTakenLine(agent: AgentRef): string {
  return `This code already belongs to ${agent.fullName}, ${agent.code}, ${agent.state}`
}

function students(count: number): string {
  return `${count} ${count === 1 ? "student" : "students"}`
}

// "This code belonged to retired record [name]. N students carry it."
export function retiredCodeLine(agent: { fullName: string }, studentCount: number): string {
  return `This code belonged to retired record ${agent.fullName}. ${students(studentCount)} ${studentCount === 1 ? "carries" : "carry"} it.`
}

// The tick the Manager gives before a Recreate.
export function samePersonLabel(code: string, studentCount: number): string {
  return `This is the same person. The ${students(studentCount)} carrying ${code} move to the new record.`
}

export const FIELD_LABELS: Record<AgentDraftField, string> = {
  full_name: "Full name",
  phone: "Mobile",
  whatsapp: "WhatsApp",
  email: "Email",
  code: "Existing code",
}

const FIELD_HINTS: Record<AgentDraftField, string> = {
  full_name: "Write the agent's full name, 2 to 100 characters.",
  phone: "Write a Tanzanian mobile number, such as 0712 345 678.",
  whatsapp: "Write the WhatsApp number as a Tanzanian mobile, or leave it empty.",
  email: "Write a whole email address, such as name@example.com, or leave it empty.",
  code: "A code uses only letters, digits, - and ., up to 20 characters. Leave it empty to make a new one.",
}

export const AGENT_LOST = "The agent could not be confirmed as saved. Check your connection, reload the page and search for the agent's phone before trying again."

const CREATE_REFUSED: Record<Exclude<CreateAgentError["kind"], "invalid" | "email-taken"> | "signed-out", string> = {
  forbidden: "You don't have permission to add Marketing Agents.",
  unavailable: "The agent could not be checked just now. Nothing was saved. Try again in a moment.",
  uncertain: AGENT_LOST,
  "signed-out": "Your session has ended. Sign in again, then add the agent.",
}

export type DraftRefusal = { message: string; field?: AgentDraftField }

export function createRefusal(error: CreateAgentError | { kind: "signed-out" }): DraftRefusal {
  if (error.kind === "invalid") return { message: FIELD_HINTS[error.field], field: error.field }
  if (error.kind === "email-taken") return { message: emailTakenMessage(error), field: "email" }
  return { message: CREATE_REFUSED[error.kind] }
}

export function createdMessage(agent: { fullName: string; code: string }): string {
  return `${agent.fullName} (${agent.code}) is added and Approved.`
}

const RECREATE_REFUSED: Record<Exclude<RecreateError["kind"], "invalid" | "phone-taken" | "email-taken"> | "signed-out", string> = {
  forbidden: "You don't have permission to recreate a Marketing Agent.",
  "not-found": "This agent could not be found. Reload the page and try again.",
  retired: "This record can't be recreated: its code already belongs to a current agent. Reload the page to see the agents as they are now.",
  unavailable: "The record could not be read just now. Try again in a moment.",
  uncertain: "The Recreate could not be confirmed. Check your connection, reload the page and see whether the agent was recreated.",
  "signed-out": "Your session has ended. Sign in again, then try again.",
}

export function recreateRefusal(error: RecreateError | { kind: "signed-out" }): DraftRefusal {
  if (error.kind === "invalid") {
    if (error.field === "reason") return { message: `Write a reason, up to ${STATUS_REASON_MAX} characters.` }
    return { message: FIELD_HINTS[error.field], field: error.field }
  }
  if (error.kind === "phone-taken") return { message: `${phoneTakenLine(error.agent)}. Nothing was changed.`, field: "phone" }
  if (error.kind === "email-taken") return { message: emailTakenMessage(error), field: "email" }
  return { message: RECREATE_REFUSED[error.kind] }
}

export function recreatedMessage(result: { agent: { fullName: string; code: string }; studentCount: number; feeChangeCount: number }): string {
  const count = result.feeChangeCount
  const fees = count === 0 ? "No interview fee changed." : `${count} ${count === 1 ? "family's" : "families'"} interview fee changed.`
  return `${result.agent.fullName} (${result.agent.code}) is recreated. ${students(result.studentCount)} ${result.studentCount === 1 ? "keeps" : "keep"} the code. ${fees}`
}
