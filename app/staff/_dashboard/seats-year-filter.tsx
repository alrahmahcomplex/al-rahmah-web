"use client"

import { FunnelIcon } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { SEATS_YEAR_KEY, seatsHref } from "./filters"

// The filter icon on Seats by class and its one dropdown, the Enrollment
// year, offering the years with a Fee schedule. A change goes into the
// address at once and leaves the other panels' filters alone.
export function SeatsYearFilter({ year, years }: { year: number; years: number[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // The year as the dropdown shows it: a change shows at once, before the
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
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={searchParams.has(SEATS_YEAR_KEY) ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Filter Seats by class"
          />
        }
      >
        <FunnelIcon aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto min-w-64">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="seats-filter-year">Enrollment year</Label>
          <Select
            items={Object.fromEntries(years.map((each) => [String(each), String(each)]))}
            value={String(shown)}
            onValueChange={(value) => value && choose(Number(value))}
          >
            <SelectTrigger id="seats-filter-year" aria-label="Enrollment year" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((each) => (
                <SelectItem key={each} value={String(each)}>
                  {each}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  )
}
