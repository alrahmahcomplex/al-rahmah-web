"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { Popover } from "@/components/kit"

import { FilterButton } from "../../_form-parts/filter-button"
import { MenuChoiceList } from "../../_form-parts/choice-list"
import { SEATS_YEAR_KEY, seatsHref } from "./filters"

// The filter button on Seats by class and its one list, the Enrollment
// year, offering the years with a Fee schedule. A change goes into the
// address at once and leaves the other panels' filters alone.
export function SeatsYearFilter({ year, years }: { year: number; years: number[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // The year as the list shows it: a change shows at once, before the
  // page for it arrives, and the page's year takes over when one arrives.
  const [shown, setShown] = useState(year)
  const [arrived, setArrived] = useState(year)
  if (year !== arrived) {
    setArrived(year)
    setShown(year)
  }

  function choose(next: number) {
    if (next === shown) return
    setShown(next)
    router.push(seatsHref(new URLSearchParams(searchParams), next), { scroll: false })
  }

  return (
    <Popover
      trigger={
        <FilterButton label="Filter Seats by class" on={searchParams.has(SEATS_YEAR_KEY)} />
      }
      title="Seats by class"
      closeLabel="Close"
    >
      <div className="rp-filter">
        <div>
          <label htmlFor="seats-filter-year">Enrollment year</label>
          <MenuChoiceList
            id="seats-filter-year"
            aria-label="Enrollment year"
            options={years.map((each) => ({ value: String(each), label: String(each) }))}
            value={String(shown)}
            onValueChange={(value) => choose(Number(value))}
          />
        </div>
      </div>
    </Popover>
  )
}
