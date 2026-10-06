import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { listReApplications, type ReApplicationList } from "@/lib/services/re-applications"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { differingText, when } from "./format"
import { LeadBadges } from "./lead-badges"
import { parseReApplicationSearch, reApplicationsHref, type ReApplicationSearch } from "./search-params"

export const metadata: Metadata = {
  title: "Re-applications · Al-Rahmah Complex",
}

// Admission forms that named a child already on file. The queue holds the
// unreviewed ones, oldest first; Show reviewed lists the ones dealt with.
export default async function ReApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const search = parseReApplicationSearch(await searchParams)
  const results = await listReApplications(await createClient(), search)
  const reviewed = search.filter === "reviewed"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Re-applications</h1>
        <p className="text-sm text-muted-foreground">
Admission forms that named a child already on file.</p>
      </div>

      <nav aria-label="Review state" className="flex flex-wrap items-center gap-2">
        <Link
          href={reApplicationsHref(search, { filter: reviewed ? "unreviewed" : "reviewed", page: 1 })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {reviewed ? "Show unreviewed" : "Show reviewed"}
        </Link>
      </nav>

      {!results.ok ? (
        <Alert variant="destructive">
          <AlertDescription>Re-applications could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <Results results={results.data} search={search} />
      )}
    </div>
  )
}

function Results({ results, search }: { results: ReApplicationList; search: ReApplicationSearch }) {
  const { reApplications, total, page, pageCount } = results
  const reviewed = search.filter === "reviewed"
  const counted = `${total} ${reviewed ? "reviewed" : "unreviewed"} ${total === 1 ? "re-application" : "re-applications"}`

  return (
    <section aria-label="Results" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? (reviewed ? "No re-application has been reviewed yet." : "No re-applications wait for review.") : counted}
      </p>

      {reApplications.length > 0 && (
        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <table aria-label="Re-applications" className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Admission Number</th>
                <th scope="col" className="px-3 py-2 font-medium">Student</th>
                <th scope="col" className="px-3 py-2 font-medium">Lead</th>
                <th scope="col" className="px-3 py-2 font-medium">Arrived</th>
                <th scope="col" className="px-3 py-2 font-medium">Differences</th>
                {reviewed && <th scope="col" className="px-3 py-2 font-medium">Reviewed</th>}
              </tr>
            </thead>
            <tbody>
              {reApplications.map((entry) => (
                <tr key={entry.id} className="border-b align-top last:border-b-0 hover:bg-slate-50">
                  <th scope="row" className="px-3 py-2 font-medium whitespace-nowrap">
                    <Link
                      href={`/staff/re-applications/${entry.id}`}
                      className="font-mono text-blue-600 underline-offset-4 hover:underline"
                    >
                      {entry.admissionNumber}
                    </Link>
                  </th>
                  <td className="px-3 py-2 text-slate-900">{entry.studentName}</td>
                  <td className="px-3 py-2">
                    <LeadBadges status={entry.status} closure={entry.closure} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <time dateTime={entry.receivedAt}>{when(entry.receivedAt)}</time>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{differingText(entry.differingFields.length)}</td>
                  {reviewed && (
                    <td className="px-3 py-2">
                      <p>{entry.reviewedBy ?? "Unknown"}</p>
                      {entry.reviewedAt && (
                        <time dateTime={entry.reviewedAt} className="text-xs whitespace-nowrap text-muted-foreground">
                          {when(entry.reviewedAt)}
                        </time>
                      )}
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
            <Link href={reApplicationsHref(search, { page: page - 1 })} className={buttonVariants({ variant: "outline" })}>
              Previous
            </Link>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </p>
          {page < pageCount ? (
            <Link href={reApplicationsHref(search, { page: page + 1 })} className={buttonVariants({ variant: "outline" })}>
              Next
            </Link>
          ) : null}
        </nav>
      )}
    </section>
  )
}
