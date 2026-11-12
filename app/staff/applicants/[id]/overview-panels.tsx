import Link from "next/link"

import { KeyValueList, Note } from "@/components/kit"
import { enrollmentYears, formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { listContactChildren } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../../fees/format"
import { describeLeadHistory } from "./history/describe"
import { CardHeading } from "./lead-card"
import { ContactEditor, StudentEditor } from "./lead-editors"
import { readFee, readFollowUps } from "./lead-reads"
import { parentRows, studentRows } from "./lead-rows"
import { Details } from "./lead-summary"
import type { LeadPanelProps } from "./panels"
import { SeatPriorityTag } from "./seat-priority-tag"
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
    <section aria-labelledby="lead-fee-summary" className="lr-card">
      <CardHeading
        id="lead-fee-summary"
        title="School fee summary"
        action={
          <Link href={leadTabHref(lead.id, "school-fee")} className="lr-link">
            Open School fee
          </Link>
        }
      />
      {!fee.ok ? (
        <Note tone="bad">The School fee could not be loaded. Try again in a moment.</Note>
      ) : fee.data.kind === "no-schedule" ? (
        <p className="lr-quiet">No fee schedule for {fee.data.year} yet.</p>
      ) : (
        <KeyValueList
          items={[
            { key: "Annual fee", value: formatShillings(fee.data.schoolFee), numeric: true },
            { key: "Paid", value: formatShillings(fee.data.totalPaid), numeric: true },
            { key: "Balance", value: formatShillings(fee.data.balance), numeric: true },
            {
              key: "Seat priority",
              value: fee.data.priority ? <SeatPriorityTag priority={fee.data.priority} /> : "none yet",
              reason:
                fee.data.priority && fee.data.priorityReachedOn ? `since ${formatDate(fee.data.priorityReachedOn)}` : undefined,
            },
          ]}
        />
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
    <section aria-labelledby="lead-recent-activity" className="lr-card">
      <CardHeading
        id="lead-recent-activity"
        title="Recent activity"
        action={
          <Link href={`/staff/applicants/${lead.id}/history`} className="lr-link">
            Full history
          </Link>
        }
      />
      {!history.ok ? (
        <Note tone="bad">The history could not be loaded. Try again in a moment.</Note>
      ) : entries.length === 0 ? (
        <p className="lr-quiet">No changes yet.</p>
      ) : (
        <ol aria-label="Recent activity" className="lr-list">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3">
              <time dateTime={entry.at} className="lr-small w-24 shrink-0 pt-px">
                {formatDate(tanzaniaToday(new Date(entry.at)))}
              </time>
              <p className="lr-text min-w-0 break-words">
                <span className="font-semibold">{entry.actor}</span> {entry.summary}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
