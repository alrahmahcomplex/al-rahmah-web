import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { searchLeads, type LeadSearchResults } from "@/lib/services/leads"
import { listSeatPriorities, type LeadSeatPriority } from "@/lib/services/school-fee-payments"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { LeadSearchBar } from "./lead-search-bar"
import { leadsHref, parseLeadSearch } from "./search-params"
import { SeatPriorityBadge } from "./seat-priority-badge"

export const metadata: Metadata = {
  title: "Leads · Al-Rahmah Complex",
}

const EMPTY: Record<LeadSearchResults["mode"], string> = {
  number: "No lead with this Admission Number.",
  name: "No lead matches this name.",
  list: "No leads to show with these filters.",
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const search = parseLeadSearch(await searchParams)
  const supabase = await createClient()
  const results = await searchLeads(supabase, search)
  // Seat priorities need payments.view. They only decorate the rows, so if
  // they can't be read the list still shows, without the column.
  const priorities =
    results.ok && staff.permissions.includes("payments.view")
      ? await listSeatPriorities(supabase, results.data.leads.map((lead) => lead.id))
      : null

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Leads</h1>
      {/* Keyed on the URL, so the box shows the search the page is showing. */}
      <LeadSearchBar key={leadsHref(search)} search={search} />

      {!results.ok ? (
        <Alert variant="destructive">
          <AlertDescription>Leads could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <>
          {/* The list still works without the column, but staff are told it's missing. */}
          {priorities && !priorities.ok && (
            <Alert variant="destructive">
              <AlertDescription>Seat priority could not be loaded, so it isn&apos;t shown. Try again in a moment.</AlertDescription>
            </Alert>
          )}
          <Results results={results.data} search={search} priorities={priorities?.ok ? priorities.data : null} />
        </>
      )}
    </div>
  )
}

function Results({
  results,
  search,
  priorities,
}: {
  results: LeadSearchResults
  search: ReturnType<typeof parseLeadSearch>
  // By lead id; null hides the column.
  priorities: Record<string, LeadSeatPriority> | null
}) {
  const { leads, total, page, pageCount, mode } = results
  const summary =
    mode === "list" ? `${total} ${total === 1 ? "lead" : "leads"}` : `${total} ${total === 1 ? "match" : "matches"}`

  return (
    <section aria-label="Results" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? EMPTY[mode] : summary}
      </p>

      {leads.length > 0 && (
        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <table aria-label="Leads" className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Admission Number</th>
                <th scope="col" className="px-3 py-2 font-medium">Student</th>
                <th scope="col" className="px-3 py-2 font-medium">Class</th>
                <th scope="col" className="px-3 py-2 font-medium">Year</th>
                <th scope="col" className="px-3 py-2 font-medium">Day or boarding</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                {priorities && <th scope="col" className="px-3 py-2 font-medium">Seat priority</th>}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b last:border-b-0 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{lead.admissionNumber}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/staff/leads/${lead.id}`}
                      className="font-medium text-slate-900 underline-offset-4 hover:underline"
                    >
                      {lead.studentName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{lead.className}</td>
                  <td className="px-3 py-2">{lead.enrollmentYear}</td>
                  <td className="px-3 py-2">{lead.dayOrBoarding}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={lead.status === "Declined" ? "destructive" : "secondary"}>{lead.status}</Badge>
                      {lead.closure && <Badge variant="outline">{lead.closure}</Badge>}
                      {lead.initiallyDeclined && <Badge variant="outline">Initially declined</Badge>}
                      {lead.returningFamily && <Badge variant="outline">Returning family</Badge>}
                    </div>
                  </td>
                  {priorities && (
                    <td className="px-3 py-2">
                      {priorities[lead.id] ? <SeatPriorityBadge priority={priorities[lead.id].priority} /> : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-3">
          {page > 1 ? (
            <Link href={leadsHref(search, { page: page - 1 })} className={buttonVariants({ variant: "outline" })}>
              Previous
            </Link>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </p>
          {page < pageCount ? (
            <Link href={leadsHref(search, { page: page + 1 })} className={buttonVariants({ variant: "outline" })}>
              Next
            </Link>
          ) : null}
        </nav>
      )}
    </section>
  )
}
