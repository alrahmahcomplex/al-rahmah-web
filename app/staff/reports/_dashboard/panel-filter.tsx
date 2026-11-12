"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { Popover } from "@/components/kit"
import { tanzaniaToday } from "@/lib/school-calendar"
import type { DashboardFilters, Period, PeriodKind } from "@/lib/services/dashboard"

import { FilterButton } from "../../_form-parts/filter-button"
import { MenuChoiceList } from "../../_form-parts/choice-list"
import { DayPicker } from "../../_form-parts/day-picker"
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

// The filter button on a dashboard panel and the lists it opens: the period
// and the Enrollment year. Each change goes into the address at once, under
// this panel's key, and leaves the other panels' filters alone.
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

  // The filters as the lists show them. A change shows at once, before
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
  const yearOptions = periodYears(today, anchor, enrollmentYears).map((year) => ({ value: String(year), label: String(year) }))

  return (
    <Popover
      trigger={
        <FilterButton label={`Filter ${title}`} on={isFiltered(shown)} />
      }
      title={title}
      closeLabel="Close"
    >
      <div className="rp-filter">
        <div>
          <label htmlFor={`${id}-period`}>Period</label>
          <MenuChoiceList
            id={`${id}-period`}
            aria-label="Period"
            options={(Object.keys(PERIOD_LABELS) as PeriodKind[]).map((kind) => ({ value: kind, label: PERIOD_LABELS[kind] }))}
            value={period.kind}
            onValueChange={(value) => chooseKind(value as PeriodKind)}
          />
        </div>

        {(period.kind === "date" || period.kind === "week") && (
          <DayPicker
            kind={period.kind}
            anchor={period.anchor}
            weekStart={period.kind === "week" ? mondayOf(period.anchor) : undefined}
            onPick={(date) => setPeriod({ kind: period.kind, anchor: period.kind === "week" ? mondayOf(date) : date } as Period)}
          />
        )}

        {(period.kind === "month" || period.kind === "year") && (
          <div className="rp-pair">
            {period.kind === "month" && (
              <MenuChoiceList
                aria-label="Month"
                className="grow"
                options={MONTHS.map((name, i) => ({ value: String(i + 1).padStart(2, "0"), label: name }))}
                value={period.anchor.slice(5, 7)}
                onValueChange={(month) => setPeriod({ kind: "month", anchor: `${period.anchor.slice(0, 4)}-${month}-01` })}
              />
            )}
            <MenuChoiceList
              aria-label="Year"
              className="grow"
              options={yearOptions}
              value={period.anchor.slice(0, 4)}
              onValueChange={(year) =>
                setPeriod(
                  period.kind === "month"
                    ? { kind: "month", anchor: `${year}-${period.anchor.slice(5, 7)}-01` }
                    : { kind: "year", anchor: `${year}-01-01` },
                )
              }
            />
          </div>
        )}

        <div>
          <label htmlFor={`${id}-year`}>Enrollment year</label>
          <MenuChoiceList
            id={`${id}-year`}
            aria-label="Enrollment year"
            options={[{ value: ALL_YEARS, label: "All years" }, ...years.map((year) => ({ value: String(year), label: String(year) }))]}
            value={enrollmentYear === null ? ALL_YEARS : String(enrollmentYear)}
            onValueChange={(value) => apply({ enrollmentYear: value === ALL_YEARS ? null : Number(value) })}
          />
        </div>
      </div>
    </Popover>
  )
}
