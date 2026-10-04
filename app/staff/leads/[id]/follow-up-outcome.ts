import { formatDate } from "@/lib/school-calendar"
import type { FollowUpField, FollowUpWriteError } from "@/lib/services/follow-ups"

// What the Follow-ups panel is told after Schedule follow-up, Change date or
// Record follow-up.
export type FollowUpOutcome =
  | { status: "saved"; message: string }
  // `conflict` when someone else changed the plan first, and a reload shows it.
  | { status: "refused"; field: FollowUpField | null; message: string; conflict?: true }

export function scheduledOutcome(dueOn: string): FollowUpOutcome {
  return { status: "saved", message: `Follow-up scheduled for ${formatDate(dueOn)}.` }
}

export function changedOutcome(dueOn: string): FollowUpOutcome {
  return { status: "saved", message: `Follow-up moved to ${formatDate(dueOn)}.` }
}

export function recordedOutcome(nextDueOn: string | null): FollowUpOutcome {
  return {
    status: "saved",
    message: nextDueOn ? `Follow-up recorded. Next follow-up on ${formatDate(nextDueOn)}.` : "Follow-up recorded.",
  }
}

const INVALID: Record<FollowUpField, string> = {
  due_on: "Pick a date from today to one year ahead.",
  note: "Keep the note to 500 characters.",
  reason: "Give a reason of 3 to 500 characters.",
  comment: "Say what was discussed in 3 to 2,000 characters.",
  method: "Pick how the family was contacted.",
  contacted_by: "Pick the staff member who made the contact from the list.",
  contacted_at: "Pick when the contact happened. It can't be later than now.",
  outcome: "Pick the next follow-up date.",
  next_due_on: "Pick a next follow-up date after today and up to one year ahead.",
  next_note: "Keep the note to 500 characters.",
}

// Turns what the follow-up module refused into a plain sentence. The codes
// never reach the screen.
export function followUpOutcome(error: FollowUpWriteError, action: "schedule" | "change" | "record"): FollowUpOutcome {
  switch (error.kind) {
    case "invalid":
      return {
        status: "refused",
        field: error.field,
        message: error.field ? INVALID[error.field] : "Check the form, then try again.",
      }
    case "conflict":
      return {
        status: "refused",
        field: null,
        conflict: true,
        message:
          action === "schedule"
            ? "This lead already has a follow-up scheduled. Reload the page to see it."
            : action === "record"
              ? "Someone else has already recorded or changed this follow-up. Nothing was saved. Reload the page to see it."
              : "This follow-up has already been changed or completed. Reload the page to see the current one.",
      }
    case "read-only":
      return { status: "refused", field: null, message: "This lead is closed, so its follow-ups can't be changed." }
    case "forbidden":
      return {
        status: "refused",
        field: null,
        message: action === "record" ? "Your role can't record follow-ups." : "Your role can't schedule or change follow-ups.",
      }
    case "not-found":
      return {
        status: "refused",
        field: null,
        message: action === "change" ? "This follow-up could not be found. Reload the page." : "This lead could not be found. Reload the page.",
      }
    case "unavailable":
      return { status: "refused", field: null, message: "The follow-up could not be saved. Nothing was changed. Try again in a moment." }
  }
}

// YYYY-MM-DD `days` after `date`.
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  const at = (date: string) => {
    const [year, month, day] = date.split("-").map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((at(to) - at(from)) / 86_400_000)
}

// How a follow-up's date stands against today in Tanzania.
export function dueLabel(dueOn: string, today: string): { text: string; overdue: boolean } {
  const days = daysBetween(today, dueOn)
  if (days === 0) return { text: "Due today", overdue: false }
  if (days === 1) return { text: "Due tomorrow", overdue: false }
  if (days > 1) return { text: `Due in ${days} days`, overdue: false }
  return { text: days === -1 ? "Overdue by 1 day" : `Overdue by ${-days} days`, overdue: true }
}
