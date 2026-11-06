import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { sendAgentInvite, type AgentInviteSender } from "./agent-invites"
import type { Result } from "./result"

// Agent invites in batches (#192), from "Approved, no account yet". The
// database chooses who to send to (skipping anyone invited in the last 24
// hours) and records the batch and each attempt; this file sends one invite
// at a time and stops at the first of these:
//
// - the batch limit: at most BATCH_LIMIT invites, below Supabase's hourly
//   email limit of 50, so resets and staff invites keep room in the hour;
// - the time limit: BATCH_TIME_LIMIT_MS, below the agents page's maxDuration
//   (60 s), itself within Vercel Hobby's function limit;
// - the daily budget: the SMTP provider's daily cap less a reserve for staff
//   invites, less the agent invite emails already counted today;
// - the first rate limit (429), after which every send would be refused.
//
// The daily cap and the reserve are configuration: EMAIL_DAILY_CAP and
// STAFF_INVITE_RESERVE (docs/agents/hosted-services.md).

export const BATCH_LIMIT = 30
export const BATCH_TIME_LIMIT_MS = 45_000

export type InviteBudgetConfig = { dailyCap: number; staffReserve: number }

function wholeNumber(value: string | undefined): number | null {
  if (value === undefined || !/^\s*\d+\s*$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

// The budget's configuration, or null while either value is missing or not
// a whole number, in which case no batch is sent.
export function readInviteBudgetConfig(env: Record<string, string | undefined> = process.env): InviteBudgetConfig | null {
  const dailyCap = wholeNumber(env.EMAIL_DAILY_CAP)
  const staffReserve = wholeNumber(env.STAFF_INVITE_RESERVE)
  if (dailyCap === null || staffReserve === null) return null
  return { dailyCap, staffReserve }
}

// How many agent invite emails may still go today.
export function dailyBudgetLeft(config: InviteBudgetConfig, usedToday: number): number {
  return Math.max(config.dailyCap - config.staffReserve - usedToday, 0)
}

export const STOP_REASONS = ["done", "batch_limit", "daily_budget", "hourly_limit", "time_limit", "access_off"] as const
export type StopReason = (typeof STOP_REASONS)[number]

export type InviteBatchError =
  | { kind: "forbidden" }
  | { kind: "access-off" }
  // The batch started but couldn't go on; its report shows how far it got.
  | { kind: "unavailable"; batchId?: string }

export type InviteBatch = { batchId: string; stopReason: StopReason }

type Started = { batch_id: string; used_today: number; budget_left: number; waiting: number; agents: { agent_id: string; email: string }[] }

export async function sendInviteBatch(
  supabase: SupabaseClient,
  send: AgentInviteSender,
  redirectTo: string,
  {
    config,
    importBatchId = null,
    limit = BATCH_LIMIT,
    timeLimitMs = BATCH_TIME_LIMIT_MS,
    now = Date.now,
  }: {
    config: InviteBudgetConfig
    // Only this import's agents; every agent when null.
    importBatchId?: string | null
    limit?: number
    timeLimitMs?: number
    now?: () => number
  },
): Promise<Result<InviteBatch, InviteBatchError>> {
  const startedAt = now()
  const started = await supabase.rpc("start_agent_invite_batch", {
    import_batch_id: importBatchId,
    daily_cap: config.dailyCap,
    staff_reserve: config.staffReserve,
    batch_limit: limit,
  })
  if (started.error) {
    if (started.error.message === "not_permitted" || started.error.code === "42501") return { ok: false, error: { kind: "forbidden" } }
    if (started.error.message === "access_off") return { ok: false, error: { kind: "access-off" } }
    console.error("Could not start an agent invite batch", started.error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const batch = ((started.data ?? []) as Started[])[0]
  if (!batch) return { ok: false, error: { kind: "unavailable" } }

  let sent = 0
  let tried = 0
  let stopReason: StopReason | null = null
  for (const agent of batch.agents) {
    if (sent >= batch.budget_left) {
      stopReason = "daily_budget"
      break
    }
    if (now() - startedAt >= timeLimitMs) {
      stopReason = "time_limit"
      break
    }
    const result = await sendAgentInvite(supabase, send, agent.agent_id, redirectTo, {
      expectedEmail: agent.email,
      batchId: batch.batch_id,
    })
    tried += 1
    if (result.ok) {
      sent += 1
      continue
    }
    const kind = result.error.kind
    if (kind === "rate-limited") {
      stopReason = "hourly_limit"
      break
    }
    if (kind === "access-off") {
      stopReason = "access_off"
      break
    }
    // The batch can't go on; it stays unfinished, and its report says so.
    if (kind === "forbidden" || kind === "batch-closed" || kind === "unavailable") {
      return { ok: false, error: { kind: "unavailable", batchId: batch.batch_id } }
    }
    // Any other refusal (changed since the batch chose them, say) or a failed
    // send leaves this agent and goes on to the next.
  }
  if (stopReason === null) {
    const more = batch.waiting > tried
    stopReason = !more ? "done" : sent >= batch.budget_left ? "daily_budget" : "batch_limit"
  }

  const finished = await supabase.rpc("finish_agent_invite_batch", { batch_id: batch.batch_id, stop_reason: stopReason })
  if (finished.error) {
    console.error("Could not finish an agent invite batch", batch.batch_id, finished.error)
    return { ok: false, error: { kind: "unavailable", batchId: batch.batch_id } }
  }
  return { ok: true, data: { batchId: batch.batch_id, stopReason } }
}

// ---------------------------------------------------------------------------
// The report, read from the database each time.
// ---------------------------------------------------------------------------

export const BATCH_OUTCOMES = ["sent", "waiting", "no_email", "failed"] as const
export type BatchOutcome = (typeof BATCH_OUTCOMES)[number]

export type InviteBatchReport = {
  id: string
  startedAt: string
  startedBy: string
  // Null while it is still sending, or when it was cut off.
  finishedAt: string | null
  stopReason: StopReason | null
  dailyCap: number
  staffReserve: number
  batchLimit: number
  usedToday: number
  waitingAtStart: number
  skippedRecent: number
  counts: { sent: number; waiting: number; noEmail: number; failed: number }
}

type ReportRow = {
  id: string
  started_at: string
  started_by_name: string
  finished_at: string | null
  stop_reason: string | null
  daily_cap: number
  staff_reserve: number
  batch_limit: number
  used_today: number
  waiting_at_start: number
  skipped_recent: number
  sent: number
  waiting: number
  no_email: number
  failed: number
}

function isStopReason(value: unknown): value is StopReason {
  return typeof value === "string" && (STOP_REASONS as readonly string[]).includes(value)
}

// The batch given, or the latest one over the same import (or over every
// agent). Null when there is none.
export async function getInviteBatchReport(
  supabase: SupabaseClient,
  { batchId, importBatchId }: { batchId?: string; importBatchId?: string },
): Promise<Result<InviteBatchReport | null, "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("agent_invite_batch_report", {
    batch_id: batchId ?? null,
    import_batch_id: importBatchId ?? null,
  })
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    // A malformed id is no batch.
    if (error.code === "22P02") return { ok: true, data: null }
    console.error("Could not read an agent invite batch", error)
    return { ok: false, error: "unavailable" }
  }
  const row = ((data ?? []) as ReportRow[])[0]
  if (!row) return { ok: true, data: null }
  return {
    ok: true,
    data: {
      id: row.id,
      startedAt: row.started_at,
      startedBy: row.started_by_name,
      finishedAt: row.finished_at,
      stopReason: isStopReason(row.stop_reason) ? row.stop_reason : null,
      dailyCap: row.daily_cap,
      staffReserve: row.staff_reserve,
      batchLimit: row.batch_limit,
      usedToday: row.used_today,
      waitingAtStart: row.waiting_at_start,
      skippedRecent: row.skipped_recent,
      counts: { sent: row.sent, waiting: row.waiting, noEmail: row.no_email, failed: row.failed },
    },
  }
}

// Agent invite emails counted today, for the Send invites dialog.
export async function getInviteBudgetUsed(supabase: SupabaseClient): Promise<Result<number, "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("agent_invite_budget_used")
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not count today's agent invite emails", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: Number(data) }
}
