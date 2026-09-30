"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LEAD_STATUSES, type ClosureFilter, type LeadSearch, type LeadStatus } from "@/lib/services/leads"

import { leadsHref } from "./search-params"

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"

const CLOSURE_LABELS: Record<ClosureFilter, string> = {
  open: "Without a closure mark",
  Inactive: "Inactive",
  Archived: "Archived",
  all: "All leads",
}

// The search box and, for the list, its filters. Everything lives in the URL,
// so a search can be shared and the back button undoes it. A filter applies
// as soon as it changes, and always starts again from the first page.
export function LeadSearchBar({ search }: { search: LeadSearch }) {
  const router = useRouter()
  const [typed, setTyped] = useState(search.query ?? "")

  // Read from both selects, not from `search`: a second change made before
  // the first one's page arrives would otherwise undo the first.
  const statusRef = useRef<HTMLSelectElement>(null)
  const closureRef = useRef<HTMLSelectElement>(null)
  function applyFilters() {
    router.push(
      leadsHref({
        status: (statusRef.current?.value || undefined) as LeadStatus | undefined,
        closure: (closureRef.current?.value ?? "open") as ClosureFilter,
        page: 1,
      }),
    )
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    router.push(leadsHref(search, { query: typed.trim() || undefined, page: 1 }))
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} role="search" className="flex max-w-xl flex-col gap-1.5">
        <Label htmlFor="lead-search">Search leads</Label>
        <div className="flex gap-2">
          <Input
            id="lead-search"
            name="q"
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="lead-search-hint"
          />
          <Button type="submit">Search</Button>
        </div>
        <p id="lead-search-hint" className="text-xs text-muted-foreground">
          An Admission Number, or any part of the student&apos;s name.
        </p>
      </form>

      {search.query ? (
        <div>
          <Link href="/staff/leads" className="text-sm font-medium text-slate-900 underline underline-offset-4">
            Clear search
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          <div className="flex w-56 flex-col gap-1.5">
            <Label htmlFor="lead-status">Status</Label>
            <select
              ref={statusRef}
              id="lead-status"
              className={SELECT_CLASS}
              defaultValue={search.status ?? ""}
              onChange={applyFilters}
            >
              <option value="">Any status</option>
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="flex w-56 flex-col gap-1.5">
            <Label htmlFor="lead-closure">Closure</Label>
            <select
              ref={closureRef}
              id="lead-closure"
              className={SELECT_CLASS}
              defaultValue={search.closure ?? "open"}
              onChange={applyFilters}
            >
              {(Object.keys(CLOSURE_LABELS) as ClosureFilter[]).map((closure) => (
                <option key={closure} value={closure}>
                  {CLOSURE_LABELS[closure]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
