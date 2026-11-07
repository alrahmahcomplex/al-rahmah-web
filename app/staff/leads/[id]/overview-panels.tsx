import Link from "next/link"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { enrollmentYears, formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { listContactChildren } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../../fees/format"
import { SeatPriorityBadge } from "../seat-priority-badge"
import { describeLeadHistory } from "./history/describe"
import { CardHeading } from "./lead-card"
import { ContactEditor, StudentEditor } from "./lead-editors"
import { readFee, readFollowUps } from "./lead-reads"
import { Details, parentRows, studentRows } from "./lead-summary"
import type { LeadPanelProps } from "./panels"
import { leadTabHref } from "./tabs"

// The Overview tab's own cards: the student and the parent or guardian with
// their corrections, a School fee summary, and the latest history entries.

// How many history entries Recent activity shows.
export const RECENT_ENTRIES = 4

export function StudentPanel({ lead, staff, open }: LeadPanelProps) {
  // A closed lead is read-only: it offers no corrections.
  const canEditDetails = open && staff.permissions.includes("leads.edit")
  const canCorrectVisit = open && lead.visitDate !== null && staff.permissions.includes("visits.record")
  return (
    <StudentEditor
      lead={lead}
      years={enrollmentYears()}
      today={tanzaniaToday()}
      canEditDetails={canEditDetails}
      canCorrectVisit={canCorrectVisit}
    >
      <Details rows={studentRows(lead)} />
    </StudentEditor>
  )
}

export async function ParentPanel({ lead, staff, open }: LeadPanelProps) {
  const canEditDetails = open && staff.permissions.includes("leads.edit")
  // The children a contact correction would also reach, closed ones included.
  // If they can't be listed, the correction is not offered, so it is never
  // made unwarned.
  const children = canEditDetails ? await listContactChildren(await createClient(), lead.contact.id) : null
  const siblings = children?.ok ? children.data.filter((child) => child.id !== lead.id) : []
  return (
    <ContactEditor lead={lead} siblings={siblings} canEdit={canEditDetails && children?.ok === true}>
      <Details rows={parentRows(lead)} />
    </ContactEditor>
  )
}

// The School fee at a glance, for staff who may view payments; the School
// fee tab has the instalments and payments.
export async function FeeSummaryPanel({ lead, staff }: LeadPanelProps) {
  if (!staff.permissions.includes("payments.view")) return null
  const fee = await readFee(lead.id)

  return (
    <section aria-labelledby="lead-fee-summary" className="flex flex-col gap-3">
      <CardHeading
        id="lead-fee-summary"
        title="School fee summary"
        action={
          <Link href={leadTabHref(lead.id, "school-fee")} className="text-sm font-medium text-blue-700 hover:underline">
            Open School fee
          </Link>
        }
      />
      {!fee.ok ? (
        <Alert variant="destructive">
          <AlertDescription>The School fee could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : fee.data.kind === "no-schedule" ? (
        <p className="text-sm text-muted-foreground">No fee schedule for {fee.data.year} yet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {(
              [
                ["Annual fee", fee.data.schoolFee],
                ["Paid", fee.data.totalPaid],
                ["Balance", fee.data.balance],
              ] as const
            ).map(([term, amount]) => (
              <div key={term} className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-slate-50 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">{term}</dt>
                <dd className="truncate font-semibold tabular-nums text-slate-900">{formatShillings(amount)}</dd>
              </div>
            ))}
          </dl>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            Seat priority
            {fee.data.priority ? (
              <>
                <SeatPriorityBadge priority={fee.data.priority} />
                {fee.data.priorityReachedOn && <span>since {formatDate(fee.data.priorityReachedOn)}</span>}
              </>
            ) : (
              <span className="text-slate-900">none yet</span>
            )}
          </p>
        </>
      )}
    </section>
  )
}

// The latest history entries, for the Super Admin, who alone reads the
// history (#237); the full history is a link away.
export async function RecentActivityPanel({ lead, staff }: LeadPanelProps) {
  if (!staff.permissions.includes("audit.view")) return null
  const [history, followUps] = await Promise.all([getLeadHistory(await createClient(), lead.id), readFollowUps(lead.id)])
  // Who made each recorded contact, by name, as the History page names them.
  const contactedBy = Object.fromEntries(
    (followUps.ok ? followUps.data.records : []).flatMap((record) =>
      record.contactedBy?.name ? [[record.contactedBy.id, record.contactedBy.name]] : [],
    ),
  )
  const entries = history.ok
    ? describeLeadHistory(history.data.entries, { ...contactedBy, ...history.data.contactNames }).slice(0, RECENT_ENTRIES)
    : []

  return (
    <section aria-labelledby="lead-recent-activity" className="flex flex-col gap-3">
      <CardHeading
        id="lead-recent-activity"
        title="Recent activity"
        action={
          <Link href={`/staff/leads/${lead.id}/history`} className="text-sm font-medium text-blue-700 hover:underline">
            Full history
          </Link>
        }
      />
      {!history.ok ? (
        <Alert variant="destructive">
          <AlertDescription>The history could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <ol aria-label="Recent activity" className="flex flex-col divide-y text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
              <time dateTime={entry.at} className="w-24 shrink-0 text-muted-foreground">
                {formatDate(tanzaniaToday(new Date(entry.at)))}
              </time>
              <p className="min-w-0 break-words text-slate-900">
                <span className="font-medium">{entry.actor}</span> {entry.summary}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
