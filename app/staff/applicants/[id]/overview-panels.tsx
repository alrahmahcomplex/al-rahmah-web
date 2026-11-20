import Link from "next/link"

import { KeyValueList, Note } from "@/components/kit"
import { enrollmentYears, formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { listContactChildren } from "@/lib/services/leads"
import { getSeatOutlook, getYearStreams, streamName } from "@/lib/services/streams"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../../fees/format"
import { GenderSheet } from "./gender-sheet"
import { describeLeadHistory } from "./history/describe"
import { CardHeading } from "./lead-card"
import { ContactEditor, StudentEditor } from "./lead-editors"
import { FatherNameRow, PreviousSchoolRow } from "./father-school"
import { readFatherAndSchool, readFee, readFollowUps, readSiblingView } from "./lead-reads"
import { parentRows, studentRows } from "./lead-rows"
import { Details } from "./lead-summary"
import type { LeadPanelProps } from "./panels"
import { SeatPriorityTag } from "./seat-priority-tag"
import { noAnswerNote } from "./seat-text"
import { SiblingGroupCard } from "./sibling-group"
import { leadTabHref } from "./tabs"

// The Overview tab's own cards: the student and the parent or guardian with
// their corrections, a School fee summary, and the latest history entries.

// How many history entries Recent activity shows.
export const RECENT_ENTRIES = 4

// The child’s seat in streams (#449, v42), for staff who may view payments:
// the stream they sit in, or that they wait for one, and the class’s streams
// for a child with no Boy or girl answer.
async function readStudentSeat(lead: LeadPanelProps["lead"], seesPayments: boolean) {
  if (!seesPayments) return { seat: null, classStreams: null }
  const supabase = await createClient()
  const [outlook, year] = await Promise.all([
    getSeatOutlook(supabase, lead.id),
    lead.gender === null ? getYearStreams(supabase, lead.enrollmentYear) : null,
  ])
  const placed = outlook.ok ? outlook.data.placed : null
  return {
    seat: placed ? streamName(placed.className, placed.label, placed.takes) : outlook.ok && outlook.data.waiting ? "Waiting for a stream" : null,
    classStreams: year?.ok ? (year.data.classes.find((c) => c.className === lead.className)?.streams ?? []) : null,
  }
}

export async function StudentPanel({ lead, staff, open }: LeadPanelProps) {
  // A closed lead is read-only: it offers no corrections.
  const canEditDetails = open && staff.permissions.includes("leads.edit")
  const canCorrectVisit = open && lead.visitDate !== null && staff.permissions.includes("visits.record")
  const [details, group, streams] = await Promise.all([
    readFatherAndSchool(lead.id),
    readSiblingView(lead.id, staff.permissions.join(",")),
    readStudentSeat(lead, staff.permissions.includes("payments.view")),
  ])
  const rows = studentRows(lead).map(([key, value]) => ({ key, value: value as React.ReactNode }))
  // Boy or girl after Day or boarding, then the seat (v42).
  const at = rows.findIndex((row) => row.key === "Day or boarding") + 1
  rows.splice(
    at,
    0,
    {
      key: "Boy or girl",
      value: (
        <span className="lr-answer">
          {lead.gender ?? <span className="lr-quiet">Not given</span>}
          {canEditDetails && (
            <GenderSheet leadId={lead.id} studentName={lead.studentName} className={lead.className} gender={lead.gender} />
          )}
        </span>
      ),
    },
    ...(streams.seat ? [{ key: "Seat", value: streams.seat as React.ReactNode }] : []),
  )
  return (
    <StudentEditor
      lead={lead}
      years={enrollmentYears()}
      today={tanzaniaToday()}
      canEditDetails={canEditDetails}
      canCorrectVisit={canCorrectVisit}
    >
      <KeyValueList items={rows} />
      {lead.gender === null && <Note>{noAnswerNote(lead, streams.classStreams)}</Note>}
      {details.ok ? (
        <div className="fs-rows">
          <FatherNameRow
            leadId={lead.id}
            studentName={lead.studentName}
            father={details.data.fatherFullName}
            enrolled={lead.status === "Enrolled"}
            compareWith={group?.compareWith ?? null}
            canEdit={canEditDetails}
          />
          <PreviousSchoolRow leadId={lead.id} className={lead.className} school={details.data.previousSchool} canEdit={canEditDetails} />
        </div>
      ) : (
        <Note tone="bad" role="alert">The father’s name and previous school could not be loaded. Try again in a moment.</Note>
      )}
    </StudentEditor>
  )
}

export async function ParentPanel({ lead, staff, open }: LeadPanelProps) {
  const canEditDetails = open && staff.permissions.includes("leads.edit")
  // The children a contact correction would also reach, closed ones included.
  // If they can't be listed, the correction is not offered, so it is never
  // made unwarned.
  const [children, details] = await Promise.all([
    canEditDetails ? listContactChildren(await createClient(), lead.contact.id) : null,
    readFatherAndSchool(lead.id),
  ])
  const siblings = children?.ok ? children.data.filter((child) => child.id !== lead.id) : []
  // Who brought the student (#298), under the custodian, as the side sheet shows it (#311).
  const broughtBy: [string, string][] = details.ok && details.data.broughtBy ? [["Brought by", details.data.broughtBy]] : []
  return (
    <ContactEditor lead={lead} siblings={siblings} canEdit={canEditDetails && children?.ok === true}>
      <Details rows={[...parentRows(lead), ...broughtBy]} />
    </ContactEditor>
  )
}

// The Sibling group (#310): every member's fee and why, the Sibling request
// waiting on the lead, and the request or the review.
export async function SiblingGroupPanel({ lead, staff, open }: LeadPanelProps) {
  const view = await readSiblingView(lead.id, staff.permissions.join(","))
  if (!view) {
    return (
      <section aria-labelledby="lead-sibling-group" className="lr-card">
        <CardHeading id="lead-sibling-group" title="Sibling group" />
        <Note tone="bad" role="alert">The sibling group could not be loaded. Try again in a moment.</Note>
      </section>
    )
  }
  return <SiblingGroupCard view={view} open={open} headingId="lead-sibling-group" />
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
        <Note tone="bad" role="alert">The School fee could not be loaded. Try again in a moment.</Note>
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
    ? describeLeadHistory(history.data.entries, { ...contactedBy, ...history.data.contactNames }, null, {
        leads: history.data.leadNames,
        streams: history.data.streamNames,
      }).slice(0, RECENT_ENTRIES)
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
        <Note tone="bad" role="alert">The history could not be loaded. Try again in a moment.</Note>
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
