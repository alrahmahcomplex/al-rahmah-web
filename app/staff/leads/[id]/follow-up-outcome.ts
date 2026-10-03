import { formatDate } from "@/lib/school-calendar"
import type { FollowUpField, FollowUpWriteError } from "@/lib/services/follow-ups"

// What the Follow-ups panel is told after Schedule follow-up or Change date.
export type FollowUpOutcome =
  | { status: "saved"; message: string }
  | { status: "refused"; field: FollowUpField | null; message: string }

export function scheduledOutcome(dueOn: string): FollowUpOutcome {
  return { status: "saved", message: `Follow-up scheduled for ${formatDate(dueOn)}.` }
}

export function changedOutcome(dueOn: string): FollowUpOutcome {
  return { status: "saved", message: `Follow-up moved to ${formatDate(dueOn)}.` }
}

const INVALID: Record<FollowUpField, string> = {
  due_on: "Pick a date from today to one year ahead.",
  note: "Keep the note to 500 characters.",
  reason: "Give a reason of 3 to 500 characters.",
}

// Turns what the follow-up module refused into a plain sentence. The codes
// never reach the screen.
export function followUpOutcome(error: FollowUpWriteError, action: "schedule" | "change"): FollowUpOutcome {
  switch (error.kind) {
    case "invalid":
      return {
        status: "refused",
        field: error.field,
        message: error.field ? INVALID[error.field] : "Check the date, note and reason, then try again.",
      }
    case "conflict":
      return {
        status: "refused",
        field: null,
        message:
          action === "schedule"
            ? "This lead already has a follow-up scheduled. Reload the page to see it."
            : "This follow-up has already been changed or completed. Reload the page to see the current one.",
      }
    case "read-only":
      return { status: "refused", field: null, message: "This lead is closed, so its follow-ups can't be changed." }
    case "forbidden":
      return { status: "refused", field: null, message: "Your role can't schedule or change follow-ups." }
    case "not-found":
      return {
        status: "refused",
        field: null,
        message: action === "schedule" ? "This lead could not be found. Reload the page." : "This follow-up could not be found. Reload the page.",
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
