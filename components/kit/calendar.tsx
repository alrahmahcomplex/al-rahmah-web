"use client"

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react"
import { DayPicker, type CalendarDay, type Modifiers } from "react-day-picker"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import { addDays, isIsoDate, isoOf, localOf, mondayOf, todayIso, withinBounds } from "./dates"
import "./kit.css"

/** The date parts' own words. Pass `words` to change any of them. */
export const DATE_WORDS = {
  wrongDate: "Type the date as day/month/year, for example 25/09/2026.",
  wrongTime: "Type the time as hours:minutes, for example 14:30.",
  openCalendar: "Open the calendar",
  chooseDate: "Choose a date",
  previousMonth: "Previous month",
  nextMonth: "Next month",
  today: "Today",
  date: "Date",
  time: "Time, 24-hour clock",
  weekOf: "Week of",
  months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
}

export type DateWords = typeof DATE_WORDS

type DayButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { day: CalendarDay; modifiers: Modifiers }

/** A day: today outlined (aria-current="date"); focus follows the keyboard, as react-day-picker's own button does. */
function DayButton({ day, modifiers, ...props }: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus({ preventScroll: true })
  }, [modifiers.focused])
  return <button ref={ref} {...props} data-day={isoOf(day.date)} aria-current={modifiers.today ? "date" : undefined} />
}

function Chevron({ orientation }: { orientation?: "up" | "down" | "left" | "right" }) {
  return <Icon name={orientation === "left" ? "back" : orientation === "right" ? "right" : "down"} />
}

export type MonthGridProps = {
  /** `day` chooses a day; `week` chooses the week of any day, Monday to Sunday. */
  mode?: "day" | "week"
  /** The chosen day ("YYYY-MM-DD"), or any day of the chosen week; "" for none. */
  value: string
  /** Called with the clicked day, "YYYY-MM-DD". In week mode the caller turns it into its Monday if it needs one. */
  onPick: (day: string) => void
  /** Days before `min` or after `max` are greyed out and cannot be chosen; so are the month arrows that lead only to them. */
  min?: string
  max?: string
  /** Focus the chosen day (or today) when it appears, as in the date field's popup. */
  autoFocus?: boolean
  words?: Partial<DateWords>
  className?: string
}

/**
 * The month grid every date part shares (prototype version 18): Monday
 * first, the month and year in Exo between round arrows, 36px round days
 * (40px on a touch screen), Lavender Mist under the pointer, today outlined,
 * the chosen day indigo. Arrow keys move by a day or a week, PageUp and
 * PageDown by a month. In week mode the chosen week is one indigo band with
 * rounded ends and the week under the pointer a Lavender Mist band.
 * On react-day-picker, as components/ui/calendar.tsx is.
 */
export function MonthGrid({ mode = "day", value, onPick, min, max, autoFocus, words: wordsProp, className }: MonthGridProps) {
  const words = { ...DATE_WORDS, ...wordsProp }
  const chosen = isIsoDate(value) ? value : ""
  const [month, setMonth] = useState(() => localOf(chosen || todayIso()))
  const [hovered, setHovered] = useState("")
  const today = todayIso()

  // A new value from outside opens its month, as the field's typed date does.
  const [shown, setShown] = useState(chosen)
  if (chosen !== shown) {
    setShown(chosen)
    if (chosen) setMonth(localOf(chosen))
  }

  const week = mode === "week" && chosen ? mondayOf(chosen) : ""
  const inWeek = (monday: string) => (date: Date) => !!monday && mondayOf(isoOf(date)) === monday
  const bandStart = (date: Date) => date.getDay() === 1 || date.getDate() === 1
  const bandEnd = (date: Date) => date.getDay() === 0 || isoOf(date) === addDays(isoOf(new Date(date.getFullYear(), date.getMonth() + 1, 1)), -1)

  return (
    <DayPicker
      // A week is a band of modifiers, not a selection; in day mode the chosen day is the selection.
      mode="single"
      selected={mode === "day" && chosen ? localOf(chosen) : undefined}
      onDayClick={(date, modifiers) => {
        if (!modifiers.disabled) onPick(isoOf(date))
      }}
      onDayMouseEnter={mode === "week" ? (date) => setHovered(mondayOf(isoOf(date))) : undefined}
      onDayMouseLeave={mode === "week" ? () => setHovered("") : undefined}
      month={month}
      onMonthChange={setMonth}
      weekStartsOn={1}
      showOutsideDays={false}
      navLayout="around"
      autoFocus={autoFocus}
      today={localOf(today)}
      startMonth={min ? localOf(min) : undefined}
      endMonth={max ? localOf(max) : undefined}
      disabled={(date: Date) => !withinBounds(isoOf(date), min, max)}
      modifiers={mode === "week" ? { band: inWeek(week), lit: inWeek(hovered), bandStart, bandEnd } : undefined}
      modifiersClassNames={{ band: "kit-cal-band", lit: "kit-cal-lit", bandStart: "kit-cal-a", bandEnd: "kit-cal-z" }}
      formatters={{
        formatCaption: (date) => `${words.months[date.getMonth()]} ${date.getFullYear()}`,
        formatWeekdayName: (date) => words.weekdays[(date.getDay() + 6) % 7],
      }}
      labels={{
        labelPrevious: () => words.previousMonth,
        labelNext: () => words.nextMonth,
        labelGrid: (date) => `${words.months[date.getMonth()]} ${date.getFullYear()}`,
        labelDayButton: (date) => `${mode === "week" ? `${words.weekOf} ` : ""}${date.getDate()} ${words.months[date.getMonth()]} ${date.getFullYear()}`,
      }}
      components={{ DayButton, Chevron }}
      className={cn("kit-cal", mode === "week" && "kit-cal-wk", className)}
      classNames={{
        months: "kit-cal-months",
        month: "kit-cal-month",
        month_caption: "kit-cal-cap",
        caption_label: "kit-cal-title",
        button_previous: "kit-round kit-cal-arrow",
        button_next: "kit-round kit-cal-arrow",
        month_grid: "kit-cal-grid",
        weekdays: "kit-cal-wds",
        weekday: "kit-cal-wd",
        weeks: "kit-cal-weeks",
        week: "kit-cal-week",
        day: "kit-cal-cell",
        day_button: "kit-cal-day",
        today: "kit-cal-today",
        selected: "kit-cal-on",
        disabled: "kit-cal-off",
        hidden: "kit-cal-hidden",
        outside: "kit-cal-out",
        focused: "kit-cal-focus",
      }}
    />
  )
}

export type CalendarProps = Omit<MonthGridProps, "autoFocus"> & {
  /** Names the calendar for a screen reader, such as "Week". */
  label?: string
}

/**
 * The open calendar (prototype version 18): the month grid sitting open in
 * a 22px-corner box inside a filter, with no field. `mode="week"` chooses a
 * week by any of its days; `mode="day"` is the date field's grid without the
 * popup.
 */
export function Calendar({ label, className, ...props }: CalendarProps) {
  return (
    <div role="group" aria-label={label} className={cn("kit-cal-open", className)}>
      <MonthGrid {...props} />
    </div>
  )
}
