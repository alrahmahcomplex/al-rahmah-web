import { formatScore } from "@/lib/result-messages"
import type { LeadHistoryEntry } from "@/lib/services/audit"

// A result release's history entry (slice 6), for describe.ts. A release is an
// action event: it changed no row, and its details say what was sent.

const ACTION = "result_released"

const CHANNELS: Readonly<Record<string, string>> = { whatsapp: "WhatsApp", sms: "SMS" }

// Labels for this event's own details only.
const LABELS: Readonly<Record<string, string>> = {
  serial_number: "S/N",
  number_used: "Sent to",
  template_id: "Message",
}

// The summary already says the channel, result and score; the interview id is
// for the database.
export const RESULT_RELEASE_HIDDEN: ReadonlySet<string> = new Set(["interview_id", "channel", "result", "score"])

const NUMBERS: Readonly<Record<string, string>> = {
  whatsapp: "The parent's WhatsApp number",
  direct: "The parent's direct phone",
}

const TEMPLATES: Readonly<Record<string, string>> = {
  whatsapp_passed_v1: "WhatsApp, Passed (version 1)",
  whatsapp_failed_v1: "WhatsApp, Failed (version 1)",
  sms_passed_v1: "SMS, Passed (version 1)",
  sms_failed_v1: "SMS, Failed (version 1)",
}

export function isResultRelease(entry: Pick<LeadHistoryEntry, "record" | "action">): boolean {
  return entry.record === null && entry.action === ACTION
}

export function resultReleaseLabel(action: string, field: string): string | null {
  return action === ACTION ? (LABELS[field] ?? null) : null
}

export function resultReleaseValue(action: string, field: string, value: unknown): string | null {
  if (action !== ACTION) return null
  if (field === "number_used") return NUMBERS[String(value)] ?? null
  if (field === "template_id") return TEMPLATES[String(value)] ?? null
  return null
}

// "sent the result by WhatsApp: Passed, 78%".
export function resultReleaseSummary(entry: LeadHistoryEntry): string {
  const detail = new Map(entry.changes.map((c) => [c.field, c.to]))
  const channel = CHANNELS[String(detail.get("channel"))] ?? String(detail.get("channel"))
  const score = detail.get("score")
  const scoreText = typeof score === "number" ? formatScore(score) : String(score)
  return `sent the result by ${channel}: ${String(detail.get("result"))}, ${scoreText}`
}
