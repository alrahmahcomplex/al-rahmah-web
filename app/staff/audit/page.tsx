import { ScrollTextIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { EmptyState } from "@/components/staff/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

import { requireStaff } from "../session"

export const metadata: Metadata = {
  title: "Audit · Al-Rahmah Complex",
}

const SELECT_CLASS =
  "h-10 w-full min-w-0 staff-touch:h-11 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="staff-heading">Audit</h1>
        <p className="text-sm text-muted-foreground">Every recorded change and action, newest first. Only you can see this page.</p>
      </div>

      <form method="get" action="/staff/audit" className="flex flex-wrap items-end gap-4" aria-label="Filter the audit">
        <div className="flex w-40 flex-col gap-1.5">
          <Label htmlFor="audit-from">From</Label>
          <Input id="audit-from" name="from" type="date" defaultValue={filters.from} />
        </div>
        <div className="flex w-40 flex-col gap-1.5">
          <Label htmlFor="audit-to">To</Label>
          <Input id="audit-to" name="to" type="date" defaultValue={filters.to} />
        </div>
        <div className="flex w-56 flex-col gap-1.5">
          <Label htmlFor="audit-actor">Who</Label>
          <select id="audit-actor" name="actor" className={SELECT_CLASS} defaultValue={filters.actor ?? ""}>
            <option value="">Anyone</option>
            {SYSTEM_ACTORS.map((actor) => (
              <option key={actor.value} value={actor.value}>
                {actor.label}
              </option>
            ))}
            {(actors.ok ? actors.data : []).map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-48 flex-col gap-1.5">
          <Label htmlFor="audit-area">Area</Label>
          <select id="audit-area" name="area" className={SELECT_CLASS} defaultValue={filters.area ?? ""}>
            <option value="">Everything</option>
            {AUDIT_AREAS.map((area) => (
              <option key={area.value} value={area.value}>
                {area.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-64 flex-col gap-1.5">
          <Label htmlFor="audit-record">Record</Label>
          <Input id="audit-record" name="record" placeholder="Admission Number or record id" defaultValue={filters.record} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          <Link href="/staff/audit" className={buttonVariants({ variant: "outline" })}>
            Clear
          </Link>
        </div>
      </form>

      {!actors.ok && (
        <Alert>
          <AlertDescription>The staff list could not be loaded, so Who offers only the system actors. Reload to try again.</AlertDescription>
        </Alert>
      )}

      {!page.ok ? (
        <Alert variant="destructive">
          <AlertDescription>
            {page.error === "invalid"
              ? "Enter a record as an Admission Number, such as ADMSN-90001, or a record id."
              : "The audit could not be loaded. Try again in a moment."}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {page.data.total === 0 ? (
            <EmptyState icon={ScrollTextIcon} title="Nothing matches." className="max-w-4xl" />
          ) : (
            <p className="text-sm text-muted-foreground">{`${page.data.total} ${page.data.total === 1 ? "entry" : "entries"}`}</p>
          )}
          <Entries entries={page.data.entries} />
          {page.data.pageCount > 1 && (
            <nav aria-label="Audit pages" className="flex items-center gap-3 text-sm">
              {page.data.page > 1 && (
                <Link href={auditHref(filters, page.data.page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Newer
                </Link>
              )}
              <span>
                Page {page.data.page} of {page.data.pageCount}
              </span>
              {page.data.page < page.data.pageCount && (
                <Link href={auditHref(filters, page.data.page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Older
                </Link>
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
    <ol aria-label="Audit entries" className="flex max-w-4xl flex-col divide-y text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-1 py-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{entry.actor}</span>
            <span>{entry.table ? `${entry.action} on ${entry.table}` : entry.action}</span>
            <Badge variant="outline">{AREA_LABELS[entry.area] ?? entry.area}</Badge>
            {entry.leadId && entry.admissionNumber && (
              <Link href={`/staff/leads/${entry.leadId}/history`} className="font-mono text-xs underline underline-offset-4">
                {entry.admissionNumber}
              </Link>
            )}
            <time dateTime={entry.at} className="text-xs text-muted-foreground">
              {WHEN.format(new Date(entry.at))}
            </time>
          </p>
          {entry.recordId && <p className="font-mono text-xs break-all text-muted-foreground">Record {entry.recordId}</p>}
          {auditChanges(entry).length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {auditChanges(entry).map((change) => (
                <li key={change.field} className="break-words">
                  {change.field}: {change.from !== null && <>{change.from} → </>}
                  <span className="text-foreground">{change.to}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
