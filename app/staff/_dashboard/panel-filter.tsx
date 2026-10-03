"use client"

import { FunnelIcon } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { tanzaniaToday } from "@/lib/school-calendar"
import type { DashboardFilters, Period, PeriodKind } from "@/lib/services/dashboard"

import { anchorFor, filtersKey, isFiltered, mondayOf, panelHref } from "./filters"

const PERIOD_LABELS: Record<PeriodKind, string> = {
  all: "All time",
  date: "Date",
  week: "Week",
  month: "Month",
  year: "Year",
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const ALL_YEARS = "all"

// A YYYY-MM-DD date as the calendar's local Date, and back.
function toLocal(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function fromLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// The years a Month or Year period can be chosen in: this year back to two
// years before the oldest Enrollment year leads carry (families visit ahead of
// the year they enroll), and never fewer than the last six, nor before 2000,
// the first year the address accepts. The one already
// chosen is added if it falls outside.
function periodYears(today: string, anchor: string | null, enrollmentYears: number[]) {
  const thisYear = Number(today.slice(0, 4))
  const oldest = Math.max(2000, Math.min(thisYear - 5, ...enrollmentYears.map((year) => year - 2)))
  const years = Array.from({ length: thisYear - oldest + 1 }, (_, i) => thisYear - i)
  const chosen = anchor ? Number(anchor.slice(0, 4)) : null
  if (chosen !== null && !years.includes(chosen)) years.push(chosen)
  return years.sort((a, b) => b - a)
}

// The filter icon on a dashboard panel and the two plain dropdowns it opens:
// the period and the Enrollment year. Each change goes into the address at
// once, under this panel's key, and leaves the other panels' filters alone.
export function PanelFilter({
  panelKey,
  title,
  filters,
  enrollmentYears,
}: {
  panelKey: string
  title: string
  filters: DashboardFilters
  enrollmentYears: number[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // The filters as the dropdowns show them. A change shows at once, before
  // the page for it arrives, so a second change made meanwhile builds on the
  // first instead of undoing it. `pending` lists every change still on its
  // way, oldest first. A page for an earlier one is passed over; the page's
  // filters take over again when the latest one arrives, or when a page
  // arrives that none of them asked for (back, forward, a link).
  const [shown, setShown] = useState(filters)
  const [pending, setPending] = useState<string[]>([])
  const [arrived, setArrived] = useState(filtersKey(filters))
  if (filtersKey(filters) !== arrived) {
    const key = filtersKey(filters)
    setArrived(key)
    const at = pending.indexOf(key)
    if (at === -1 || at === pending.length - 1) {
      setShown(filters)
      setPending([])
    } else {
      setPending(pending.slice(at + 1))
    }
  }

  const { period, enrollmentYear } = shown
  const anchor = period.kind === "all" ? null : period.anchor
  const today = tanzaniaToday()
  const id = `${panelKey}-filter`

  function apply(changes: Partial<DashboardFilters>) {
    const next = { ...shown, ...changes }
    // Nothing to wait for: the page for it would never arrive as a change.
    if (filtersKey(next) === filtersKey(shown)) return
    setShown(next)
    setPending([...pending, filtersKey(next)])
    router.push(panelHref(new URLSearchParams(searchParams), panelKey, next), { scroll: false })
  }

  function setPeriod(next: Period) {
    apply({ period: next })
  }

  function chooseKind(kind: PeriodKind) {
    if (kind === period.kind) return
    setPeriod(kind === "all" ? { kind } : { kind, anchor: anchorFor(kind, today) })
  }

  // Year options: the years leads carry, and the one chosen even if no lead
  // carries it any more.
  const years = enrollmentYear !== null && !enrollmentYears.includes(enrollmentYear)
    ? [...enrollmentYears, enrollmentYear].sort((a, b) => b - a)
    : enrollmentYears

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant={isFiltered(shown) ? "secondary" : "ghost"} size="icon-sm" aria-label={`Filter ${title}`} />
        }
      >
        <FunnelIcon aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto min-w-64">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-period`}>Period</Label>
          <Select
            items={PERIOD_LABELS}
            value={period.kind}
            onValueChange={(value) => value && chooseKind(value as PeriodKind)}
          >
            <SelectTrigger id={`${id}-period`} aria-label="Period" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as PeriodKind[]).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {PERIOD_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(period.kind === "date" || period.kind === "week") && (
          <Calendar
            // A new period kind or anchor opens the calendar on its month,
            // not on whichever month was browsed to before.
            key={`${period.kind}:${period.anchor}`}
            mode="single"
            weekStartsOn={1}
            selected={toLocal(period.anchor)}
            defaultMonth={toLocal(period.anchor)}
            onSelect={(day) => {
              if (!day) return
              const date = fromLocal(day)
              setPeriod({ kind: period.kind, anchor: period.kind === "week" ? mondayOf(date) : date } as Period)
            }}
            modifiers={
              period.kind === "week"
                ? { chosenWeek: { from: toLocal(mondayOf(period.anchor)), to: toLocal(addDays(mondayOf(period.anchor), 6)) } }
                : undefined
            }
            modifiersClassNames={{ chosenWeek: "bg-muted rounded-none first:rounded-l-md last:rounded-r-md" }}
            className="mx-auto p-0"
          />
        )}

        {(period.kind === "month" || period.kind === "year") && (
          <div className="flex gap-2">
            {period.kind === "month" && (
              <Select
                items={Object.fromEntries(MONTHS.map((name, i) => [String(i + 1).padStart(2, "0"), name]))}
                value={period.anchor.slice(5, 7)}
                onValueChange={(month) => month && setPeriod({ kind: "month", anchor: `${period.anchor.slice(0, 4)}-${month}-01` })}
              >
                <SelectTrigger aria-label="Month" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1).padStart(2, "0")}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              items={Object.fromEntries(periodYears(today, anchor, enrollmentYears).map((year) => [String(year), String(year)]))}
              value={period.anchor.slice(0, 4)}
              onValueChange={(year) =>
                year &&
                setPeriod(
                  period.kind === "month"
                    ? { kind: "month", anchor: `${year}-${period.anchor.slice(5, 7)}-01` }
                    : { kind: "year", anchor: `${year}-01-01` },
                )
              }
            >
              <SelectTrigger aria-label="Year" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periodYears(today, anchor, enrollmentYears).map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-year`}>Enrollment year</Label>
          <Select
            items={{ [ALL_YEARS]: "All years", ...Object.fromEntries(years.map((year) => [String(year), String(year)])) }}
            value={enrollmentYear === null ? ALL_YEARS : String(enrollmentYear)}
            onValueChange={(value) => value && apply({ enrollmentYear: value === ALL_YEARS ? null : Number(value) })}
          >
            <SelectTrigger id={`${id}-year`} aria-label="Enrollment year" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_YEARS}>All years</SelectItem>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

      </PopoverContent>
    </Popover>
  )
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
