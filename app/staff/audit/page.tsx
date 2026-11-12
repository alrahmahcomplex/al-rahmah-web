import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Button, ButtonLink, Card, EmptyState, Field, Note, PageHeader, Tag, pageTitle } from "@/components/kit"
import {
  AUDIT_AREAS,
  SYSTEM_ACTORS,
  auditChanges,
  auditFilters,
  auditHref,
  getAuditActors,
  getAuditPage,
  type AuditEntry,
} from "@/lib/services/system-audit"
import { createClient } from "@/utils/supabase/server"

import { ChoiceList } from "../_form-parts/choice-list"
import { DateField } from "../_form-parts/date-field"
import { requireStaff } from "../session"
import "./audit.css"

export const metadata: Metadata = {
  title: pageTitle("Audit"),
}

// The school is in Tanzania, so times read in East Africa Time.
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

const AREA_LABELS = Object.fromEntries(AUDIT_AREAS.map((area) => [area.value, area.label]))

// Every recorded change and action across leads, payments and staff
// administration, newest first. The Super Admin's alone (#237).
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("audit.view")) forbidden()

  const filters = auditFilters(await searchParams)
  const supabase = await createClient()
  const [page, actors] = await Promise.all([getAuditPage(supabase, filters), getAuditActors(supabase)])
  if (!page.ok && page.error === "forbidden") forbidden()

  return (
    <div className="au-page">
      <PageHeader title="Audit" subtitle="Every recorded change and action, newest first. Only you can see this page." />

      <form method="get" action="/staff/audit" className="au-filters" aria-label="Filter the audit">
        <div className="au-w-date">
          <label htmlFor="audit-from">From</label>
          <DateField id="audit-from" name="from" defaultValue={filters.from ?? ""} />
        </div>
        <div className="au-w-date">
          <label htmlFor="audit-to">To</label>
          <DateField id="audit-to" name="to" defaultValue={filters.to ?? ""} />
        </div>
        <div className="au-w-who">
          <label htmlFor="audit-actor">Who</label>
          <ChoiceList
            id="audit-actor"
            name="actor"
            defaultValue={filters.actor ?? ""}
            options={[
              { value: "", label: "Anyone" },
              ...SYSTEM_ACTORS.map((actor) => ({ value: actor.value, label: actor.label })),
              ...(actors.ok ? actors.data : []).map((actor) => ({ value: actor.id, label: actor.name })),
            ]}
          />
        </div>
        <div className="au-w-area">
          <label htmlFor="audit-area">Area</label>
          <ChoiceList
            id="audit-area"
            name="area"
            defaultValue={filters.area ?? ""}
            options={[{ value: "", label: "Everything" }, ...AUDIT_AREAS.map((area) => ({ value: area.value, label: area.label }))]}
          />
        </div>
        <div className="au-w-record">
          <label htmlFor="audit-record">Record</label>
          <Field
            id="audit-record"
            name="record"
            size="compact"
            alignStart
            placeholder="Admission Number or record id"
            defaultValue={filters.record}
          />
        </div>
        <div className="au-actions">
          <Button type="submit" size="small">
            Apply
          </Button>
          <ButtonLink href="/staff/audit" variant="ghost" size="small">
            Clear
          </ButtonLink>
        </div>
      </form>

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
        <>
          {page.data.total > 0 && <p className="au-total">{`${page.data.total} ${page.data.total === 1 ? "entry" : "entries"}`}</p>}
          <Card>{page.data.total === 0 ? <EmptyState title="Nothing matches." /> : <Entries entries={page.data.entries} />}</Card>
          {page.data.pageCount > 1 && (
            <nav aria-label="Audit pages" className="au-pages">
              {page.data.page > 1 && (
                <ButtonLink href={auditHref(filters, page.data.page - 1)} variant="ghost" size="small">
                  Newer
                </ButtonLink>
              )}
              <span>
                Page {page.data.page} of {page.data.pageCount}
              </span>
              {page.data.page < page.data.pageCount && (
                <ButtonLink href={auditHref(filters, page.data.page + 1)} variant="ghost" size="small">
                  Older
                </ButtonLink>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}

function Entries({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return null

  return (
    <ol aria-label="Audit entries" className="au-list">
      {entries.map((entry) => (
        <li key={entry.id} className="au-entry">
          <p className="au-line">
            <span className="au-actor">{entry.actor}</span>
            <span>{entry.table ? `${entry.action} on ${entry.table}` : entry.action}</span>
            <Tag tone="line">{AREA_LABELS[entry.area] ?? entry.area}</Tag>
            {entry.leadId && entry.admissionNumber && (
              <Link href={`/staff/applicants/${entry.leadId}/history`} className="au-number">
                {entry.admissionNumber}
              </Link>
            )}
            <time dateTime={entry.at} className="au-when">
              {WHEN.format(new Date(entry.at))}
            </time>
          </p>
          {entry.recordId && <p className="au-record">Record {entry.recordId}</p>}
          {auditChanges(entry).length > 0 && (
            <ul className="au-changes">
              {auditChanges(entry).map((change) => (
                <li key={change.field}>
                  {change.field}: {change.from !== null && <>{change.from} → </>}
                  <span className="au-to">{change.to}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
