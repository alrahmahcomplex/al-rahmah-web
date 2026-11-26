import type { Metadata } from "next"

import { Card, EmptyState, Note, PageHeader, Pagination, pageTitle } from "@/components/kit"
import { auditFilters, auditHref, getAuditActors, getAuditPage } from "@/lib/services/system-audit"
import { getAuditLookups } from "@/lib/services/system-audit-lookups"
import { createClient } from "@/utils/supabase/server"

import { describeAuditEntries } from "../_audit-words"
import StaffForbidden from "../forbidden"
import { requireStaff } from "../session"
import { AuditFiltersForm } from "./audit-filters"
import { AuditTable } from "./audit-table"
import "./audit.css"

export const metadata: Metadata = {
  title: pageTitle("Audit"),
}

// Every recorded change and action across leads, payments and staff
// administration, newest first. The Super Admin's alone (#237, #504).
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("audit.view")) return <StaffForbidden />

  const filters = auditFilters(await searchParams)
  const supabase = await createClient()
  const [page, actors] = await Promise.all([getAuditPage(supabase, filters), getAuditActors(supabase)])
  if (!page.ok && page.error === "forbidden") return <StaffForbidden />

  const actorList = actors.ok ? actors.data : []
  const entries =
    page.ok && page.data.entries.length > 0
      ? describeAuditEntries(page.data.entries, await getAuditLookups(supabase, page.data.entries, actorList))
      : []

  return (
    <div className="au-page">
      <PageHeader title="Audit" />

      <AuditFiltersForm filters={filters} actors={actorList} />

      {!actors.ok && (
        <Note tone="info">The staff list could not be loaded, so Who offers only the system actors. Reload to try again.</Note>
      )}

      {!page.ok ? (
        <Note tone="bad" role="alert">
          {page.error === "invalid"
            ? "Enter a record as an Admission Number, such as ADMSN-90001, or a record id."
            : "The audit could not be loaded. Try again in a moment."}
        </Note>
      ) : (
        <Card>
          {page.data.total === 0 ? (
            <EmptyState title="Nothing matches." />
          ) : (
            <>
              <AuditTable entries={entries} />
              <div className="au-foot">
                <p className="au-total">{`${page.data.total} ${page.data.total === 1 ? "entry" : "entries"}`}</p>
                <Pagination
                  label="Audit pages"
                  page={page.data.page}
                  pageCount={page.data.pageCount}
                  href={(p) => auditHref(filters, p)}
                  previousLabel="Newer"
                  nextLabel="Older"
                  pageLabel={(p) => `Page ${p}`}
                />
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
