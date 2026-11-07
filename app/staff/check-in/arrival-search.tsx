"use client"

import { SearchIcon, UserPlusIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import { initials } from "../_today/greeting"
import { findArrival } from "./actions"
import type { ArrivalMatch, ArrivalOutcome } from "./outcome"

const LOST_REQUEST_MESSAGE = "The lookup could not be completed. Check your connection and try again."

const NEW_FAMILY = cn(buttonVariants({ variant: "outline" }), "h-11 w-full rounded-full px-5 text-sm sm:w-auto")

// The first question at check-in: the family's Admission Number, or the
// student's name when they don't have it. A number opens the lead; a name
// lists the matches to pick from; nothing found offers another try or, for
// staff who may register, a new family.
export function ArrivalSearch({ canRegister }: { canRegister: boolean }) {
  const router = useRouter()
  const [typed, setTyped] = useState("")
  const [outcome, setOutcome] = useState<Exclude<ArrivalOutcome, { status: "found" }> | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setOutcome(null)
    // Spaces alone pass the field's own check but are nothing to look for.
    if (typed.trim() === "") {
      inputRef.current?.focus()
      return
    }
    startTransition(async () => {
      let result: ArrivalOutcome
      try {
        result = await findArrival(typed)
      } catch {
        setOutcome({ status: "refused", message: LOST_REQUEST_MESSAGE })
        return
      }
      if (result.status === "found") {
        router.push(result.href)
        return
      }
      setOutcome(result)
    })
  }

  function tryAgain() {
    setTyped("")
    setOutcome(null)
    inputRef.current?.focus()
  }

  const nothing = outcome?.status === "not-found" || (outcome?.status === "matches" && outcome.leads.length === 0)

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <form onSubmit={submit} role="search" className="flex flex-col gap-1.5">
        <Label htmlFor="arrival-search" className="sr-only">
          Admission Number or student&apos;s name
        </Label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-slate-400" />
            <Input
              ref={inputRef}
              id="arrival-search"
              name="q"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value)
                setOutcome(null)
              }}
              placeholder="Number or student name"
              autoComplete="off"
              spellCheck={false}
              required
              // Locked while a lookup runs, so its answer is always about
              // what the field shows.
              readOnly={pending}
              aria-describedby="arrival-search-hint"
              aria-invalid={nothing || undefined}
              className="h-11 rounded-xl pl-11 text-base md:text-base"
            />
          </div>
          <Button type="submit" disabled={pending} className="h-11 rounded-xl px-4">
            Find
          </Button>
        </div>
        <p id="arrival-search-hint" className="text-xs text-muted-foreground">
          With or without ADMSN-, for example 40719, or any part of the student&apos;s name.
        </p>
      </form>

      {outcome && nothing && (
        <Alert variant="destructive" role="alert" className="gap-3 p-3">
          <AlertTitle>
            {outcome.status === "not-found" ? "No lead with this Admission Number" : `No student matches “${outcome.query}”`}
          </AlertTitle>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={tryAgain}>
              Try again
            </Button>
            {canRegister && (
              <Link href="/staff/check-in/new" className={buttonVariants()}>
                New family, never registered
              </Link>
            )}
          </div>
        </Alert>
      )}
      {outcome?.status === "refused" && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{outcome.message}</AlertDescription>
        </Alert>
      )}
      {outcome?.status === "matches" && outcome.leads.length > 0 && (
        <Matches query={outcome.query} leads={outcome.leads} total={outcome.total} />
      )}

      {/* The alert above offers a new family itself when nothing matched. */}
      {canRegister && !nothing && (
        <div>
          <Link href="/staff/check-in/new" className={NEW_FAMILY}>
            <UserPlusIcon aria-hidden />
            New family, never registered
          </Link>
        </div>
      )}
    </div>
  )
}

// The leads part of a name matched, each opening the student's screen. The
// search lists active leads first, then Inactive and Archived ones, which
// are marked.
function Matches({ query, leads, total }: { query: string; leads: ArrivalMatch[]; total: number }) {
  return (
    <section aria-labelledby="arrival-matches-heading" className="flex flex-col gap-2">
      <h2 id="arrival-matches-heading" className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
        {total === 1 ? "1 student matches" : `${total.toLocaleString("en-US")} students match`} “{query}”
      </h2>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {leads.map((lead) => (
          <li key={lead.id}>
            <Link
              href={`/staff/leads/${lead.id}`}
              className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-slate-50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600"
              >
                {initials(lead.studentName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{lead.studentName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  <span className="font-mono">{lead.admissionNumber}</span>
                  {" · "}
                  {lead.className}
                  {" · "}
                  {lead.enrollmentYear}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                <Badge variant={lead.status === "Declined" ? "destructive" : "secondary"}>{lead.status}</Badge>
                {lead.closure && <Badge variant="outline">{lead.closure}</Badge>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {total > leads.length && (
        <p className="text-xs text-muted-foreground">
          Showing the first {leads.length} of {total.toLocaleString("en-US")}. Add more of the name, or{" "}
          <Link href={`/staff/leads?q=${encodeURIComponent(query)}`} className="font-medium text-blue-600 underline underline-offset-4">
            search on Leads
          </Link>
          .
        </p>
      )}
    </section>
  )
}
