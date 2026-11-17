"use client"

import { Calendar } from "@/components/kit"

// The open day and week picker: the kit's Calendar (#358). It hands back the
// clicked day; the caller turns it into a week's Monday.
export function DayPicker({
  kind,
  anchor,
  onPick,
}: {
  kind: "date" | "week"
  /** The chosen day, or the chosen week's Monday, as YYYY-MM-DD. */
  anchor: string
  /** Kept for its callers; the kit Calendar bands the week of `anchor` itself. */
  weekStart?: string
  onPick: (day: string) => void
}) {
  return <Calendar mode={kind === "week" ? "week" : "day"} value={anchor} onPick={onPick} />
}
