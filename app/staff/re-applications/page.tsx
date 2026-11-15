import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { ButtonLink, Card, EmptyState, Note, PageHeader, pageTitle, Pagination } from "@/components/kit"
import { listReApplications, type ReApplicationList } from "@/lib/services/re-applications"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { differingText, when } from "./format"
import { ReApplicationsTable, type ReApplicationRow } from "./re-applications-table"
import { parseReApplicationSearch, reApplicationsHref, type ReApplicationSearch } from "./search-params"
import "./re-applications.css"

export const metadata: Metadata = {
  title: pageTitle("Re-applications"),
}

// Admission forms that named a child already on file. The queue holds the
// unreviewed ones, oldest first; Show reviewed lists the ones dealt with.
// Drawn in the new shell (#328).
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
    <>
      <PageHeader title="Re-applications" subtitle="Admission forms that named a child already on file." />
      <div className="ra-stack">
        <nav aria-label="Review state" className="ra-tools">
          <ButtonLink href={reApplicationsHref(search, { filter: reviewed ? "unreviewed" : "reviewed", page: 1 })} variant="ghost" size="small">
            {reviewed ? "Show unreviewed" : "Show reviewed"}
          </ButtonLink>
        </nav>

        {!results.ok ? (
          <Note tone="bad" role="alert">
            Re-applications could not be loaded. Try again in a moment.
          </Note>
        ) : (
          <Results results={results.data} search={search} />
        )}
      </div>
    </>
  )
}

function Results({ results, search }: { results: ReApplicationList; search: ReApplicationSearch }) {
  const { reApplications, total, page, pageCount } = results
  const reviewed = search.filter === "reviewed"
  const counted = `${total} ${reviewed ? "reviewed" : "unreviewed"} ${total === 1 ? "re-application" : "re-applications"}`
  const rows: ReApplicationRow[] = reApplications.map((entry) => ({
    id: entry.id,
    admissionNumber: entry.admissionNumber,
    studentName: entry.studentName,
    status: entry.status,
    closure: entry.closure,
    receivedAt: entry.receivedAt,
    receivedOn: when(entry.receivedAt),
    differences: differingText(entry.differingFields.length),
    reviewedBy: entry.reviewedBy,
    reviewedAt: entry.reviewedAt,
    reviewedOn: entry.reviewedAt ? when(entry.reviewedAt) : null,
  }))

  return (
    <section aria-label="Results" className="ra-stack">
      {total === 0 ? (
        <Card role="status">
          <EmptyState
            illustration={reviewed ? "search" : "inbox"}
            title={reviewed ? "No re-application has been reviewed yet." : "No re-applications wait for review."}
          />
        </Card>
      ) : (
        <p className="ra-count" aria-live="polite">
          {counted}
        </p>
      )}

      {rows.length > 0 && (
        <Card>
          <ReApplicationsTable rows={rows} reviewed={reviewed} />
        </Card>
      )}

      <Pagination
        label="Re-application pages"
        page={page}
        pageCount={pageCount}
        href={(each) => reApplicationsHref(search, { page: each })}
        previousLabel="Previous page"
        nextLabel="Next page"
        pageLabel={(each) => `Page ${each}`}
      />
    </section>
  )
}
