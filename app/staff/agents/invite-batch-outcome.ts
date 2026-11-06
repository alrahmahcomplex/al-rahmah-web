import type { InviteBatchReport, InviteBudgetConfig } from "@/lib/services/agent-invite-batches"

import { ACCESS_OFF_CODE } from "./access-banner"

// The Agents screen's words for invite batches (#192). Times are in East
// Africa Time. "Sent" means Auth accepted the email, never that it arrived.

const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// How long after it started an unfinished batch is taken as cut off: past
// any function's time limit on Vercel Hobby (300 s), with a margin.
const CUT_OFF_AFTER_MS = 6 * 60 * 1000

// The provider's day is the UTC day, which starts at 03:00 East Africa Time.
const BUDGET_RESETS = "03:00 East Africa Time"

export function batchHeading(report: InviteBatchReport): string {
  const started = `Started ${WHEN.format(new Date(report.startedAt))} by ${report.startedBy}`
  return report.finishedAt ? `${started}, finished ${WHEN.format(new Date(report.finishedAt))}` : started
}

function agentBudget(config: InviteBudgetConfig): string {
  return `${Math.max(config.dailyCap - config.staffReserve, 0)} a day (the email service's ${config.dailyCap}, less ${config.staffReserve} kept for staff invites)`
}

// Why the batch stopped. The hourly limit and the daily budget are told
// apart: the first is Supabase's, shared by every email and gone within the
// hour; the second is the agents' share of the email service's day.
export function batchStopLine(report: InviteBatchReport, now: number = Date.now()): string {
  switch (report.stopReason) {
    case "done":
      return report.waitingAtStart === 0 ? "No agent was waiting for an invite." : "Every agent waiting for an invite was tried."
    case "batch_limit":
      return `Stopped after ${report.batchLimit} invites, the most one batch sends, so the hourly email limit keeps room for staff invites and password resets. Send the next batch when you're ready.`
    case "daily_budget":
      return `Stopped at today's budget for agent invites: ${agentBudget(report)}. It resets at ${BUDGET_RESETS}.`
    case "hourly_limit":
      return "Stopped at Supabase's hourly email limit, which every email shares. This isn't the daily budget: send the next batch in an hour."
    case "time_limit":
      return "Stopped at the time one batch may take. Send the next batch to carry on."
    case "access_off":
      return `Stopped because agent access was turned off (${ACCESS_OFF_CODE}).`
    default:
      return now - new Date(report.startedAt).getTime() > CUT_OFF_AFTER_MS
        ? "This batch stopped before it finished, perhaps at the hosting time limit. The counts are read from what was recorded."
        : "This batch may still be sending. Reload the page for the latest counts."
  }
}

export function skippedLine(report: InviteBatchReport): string | null {
  if (report.skippedRecent === 0) return null
  return `${report.skippedRecent} skipped as invited in the last 24 hours.`
}

// The Send invites dialog's line on today's budget, or why there is none.
export function budgetLine(config: InviteBudgetConfig | null, usedToday: number | null): string {
  if (!config) return "The daily email budget isn't configured (EMAIL_DAILY_CAP and STAFF_INVITE_RESERVE), so no batch can be sent."
  const budget = Math.max(config.dailyCap - config.staffReserve, 0)
  if (usedToday === null) return `Today's budget for agent invites is ${agentBudget(config)}. It resets at ${BUDGET_RESETS}.`
  return `Today's budget for agent invites: ${Math.min(usedToday, budget)} of ${budget} used, ${Math.max(budget - usedToday, 0)} left. That's ${agentBudget(config)}; it resets at ${BUDGET_RESETS}.`
}

export type BatchActionOutcome =
  | { status: "finished"; batchId: string }
  | { status: "stopped"; batchId: string; message: string }
  | { status: "refused"; message: string }
