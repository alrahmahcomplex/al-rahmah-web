import { formatDate } from "@/lib/school-calendar"
import type { FollowUpRecord } from "@/lib/services/follow-ups"

// Times on a follow-up record, read and written in Tanzania time, which is
// UTC+3 all year with no daylight saving.
const TANZANIA = "Africa/Dar_es_Salaam"
const TANZANIA_OFFSET = "+03:00"

const WHEN = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TANZANIA })

// An ISO timestamp as a reader in Tanzania would say it, such as
// "4 Oct 2026, 14:30".
export function formatContactTime(iso: string): string {
  return WHEN.format(new Date(iso))
}

// Now in Tanzania as a datetime-local value, YYYY-MM-DDTHH:mm.
export function tanzaniaNowLocal(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TANZANIA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// A datetime-local value typed in Tanzania time, as an ISO timestamp; null
// when it isn't one.
export function fromTanzaniaLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const at = new Date(`${value}:00${TANZANIA_OFFSET}`)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

// The entry time is shown only when it differs from the contact time by more
// than an hour: a call entered late.
export function enteredLate(record: Pick<FollowUpRecord, "contactedAt" | "enteredAt">): boolean {
  if (!record.contactedAt) return false
  return Math.abs(Date.parse(record.enteredAt) - Date.parse(record.contactedAt)) > 3_600_000
}

const CAUSES: Record<NonNullable<FollowUpRecord["cause"]>, string> = {
  declined: "Declined",
  inactive: "Inactive",
  archived: "Archived",
}

// How a record ended, in words. `nextDueOn` is the date of the follow-up it
// planned, when there is one.
export function recordOutcomeText(record: Pick<FollowUpRecord, "kind" | "outcome" | "cause">, nextDueOn: string | null): string {
  if (record.kind === "closed_with_lead") return record.cause ? `Closed with the lead (${CAUSES[record.cause]})` : "Closed with the lead"
  switch (record.outcome) {
    case "next_date":
      return nextDueOn ? `Next follow-up: ${formatDate(nextDueOn)}` : "Next follow-up planned"
    case "lead_enrolled":
      return "No next date: the lead is Enrolled"
    case "lead_declined":
      return "The family will not proceed: lead declined"
    default:
      return "Recorded"
  }
}
