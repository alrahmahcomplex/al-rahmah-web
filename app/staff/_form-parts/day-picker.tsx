"use client"

import { Calendar } from "@/components/ui/calendar"

// The inline day and week picker, until #358 brings the kit's (see
// README.md): today's Calendar, Monday first, with the chosen week drawn as
// one band. It hands back the clicked day; the caller turns it into a week.

// A YYYY-MM-DD date as the calendar's local Date, and back.
function toLocal(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function fromLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function DayPicker({
  kind,
  anchor,
  weekStart,
  onPick,
}: {
  kind: "date" | "week"
  /** The chosen day, or the chosen week's Monday, as YYYY-MM-DD. */
  anchor: string
  /** In week mode, the Monday of the week to draw as a band. */
  weekStart?: string
  onPick: (day: string) => void
}) {
  return (
    <Calendar
      // A new kind or anchor opens the calendar on its month, not on
      // whichever month was browsed to before.
      key={`${kind}:${anchor}`}
      mode="single"
      weekStartsOn={1}
      selected={toLocal(anchor)}
      defaultMonth={toLocal(anchor)}
      onSelect={(day) => day && onPick(fromLocal(day))}
      modifiers={
        kind === "week" && weekStart ? { chosenWeek: { from: toLocal(weekStart), to: toLocal(addDays(weekStart, 6)) } } : undefined
      }
      modifiersClassNames={{ chosenWeek: "bg-muted rounded-none first:rounded-l-md last:rounded-r-md" }}
      className="mx-auto p-0"
    />
  )
}
