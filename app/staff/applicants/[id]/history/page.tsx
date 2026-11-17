import type { Metadata } from "next"

import { ButtonLink, Card, Note, PageHeader, pageTitle, Timeline } from "@/components/kit"
import { getLeadHistory } from "@/lib/services/audit"
import { getLeadFollowUps } from "@/lib/services/follow-ups"
import { getLead } from "@/lib/services/leads"
import { getLeadImportMark } from "@/lib/services/student-import"
import { createClient } from "@/utils/supabase/server"

import StaffForbidden from "../../../forbidden"
import StaffNotFound from "../../../not-found"
import { requireStaff } from "../../../session"
import "../lead.css"
import { describeLeadHistory, type DescribedEntry } from "./describe"
import "./history.css"

export const metadata: Metadata = {
  title: pageTitle("Application history"),
}

// The school is in Tanzania, so times read in East Africa Time whatever the
// server's own zone is.
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// Every change to a lead and to the parent or guardian it is or was linked
// to, newest first: who made it, when, and each field's old and new value.
// For the Super Admin alone (#237).
export default async function LeadHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("audit.view")) return <StaffForbidden />

  const { id } = await params
  const supabase = await createClient()
  const [lead, history, followUps, importMark] = await Promise.all([
    getLead(supabase, id),
    getLeadHistory(supabase, id),
    getLeadFollowUps(supabase, id),
    getLeadImportMark(supabase, id),
  ])
  // The file an imported lead came from; without it the line still says the
  // import created the lead.
  const importFile = importMark.ok ? (importMark.data.batch?.fileName ?? null) : null
  if (!lead.ok && lead.error === "not-found") return <StaffNotFound />
  // Who made each recorded contact, by name alongside the contacts' names.
  const contactedBy = Object.fromEntries(
    (followUps.ok ? followUps.data.records : []).flatMap((record) =>
      record.contactedBy?.name ? [[record.contactedBy.id, record.contactedBy.name]] : [],
    ),
  )

  return (
    // The header keeps its own space below it, so the page gap starts after it.
    <div>
      <PageHeader
        title="History"
        subtitle={
          lead.ok && (
            <>
              {lead.data.studentName} · <span className="lr-number">{lead.data.admissionNumber}</span>
            </>
          )
        }
      />
      <div className="lr-page">
        {!lead.ok || !history.ok ? (
          <Note tone="bad" role="alert">
            This application&apos;s history could not be loaded. Try again in a moment.
          </Note>
        ) : (
          <>
            {!followUps.ok && (
              <Note tone="wait" role="alert">
                The names of staff who made contacts could not be loaded, so some contact entries show an id. Reload to try
                again.
              </Note>
            )}
            <Card className="lh-card">
              <Entries entries={describeLeadHistory(history.data.entries, { ...contactedBy, ...history.data.contactNames }, importFile)} />
            </Card>
          </>
        )}

        <div>
          <ButtonLink href={`/staff/applicants/${id}`} variant="ghost">
            Back to the application
          </ButtonLink>
        </div>
      </div>
    </div>
  )
}

function Entries({ entries }: { entries: DescribedEntry[] }) {
  // A plain line: none of the kit's empty pictures (no match, nothing due, no
  // request waiting) says "nothing has changed yet".
  if (entries.length === 0) return <p className="lr-quiet">No changes yet.</p>

  return (
    <Timeline
      label="History"
      items={entries.map((entry) => ({
        key: entry.id,
        title: (
          <>
            {entry.actor} {entry.summary}
          </>
        ),
        meta: <time dateTime={entry.at}>{WHEN.format(new Date(entry.at))}</time>,
        children: (
          <>
            {entry.note && <p className="lh-note">{entry.note}</p>}
            {entry.changes.length > 0 && (
              <ul className="lr-trail">
                {entry.changes.map((change) => (
                  <li key={change.label} className="lh-change">
                    {change.label}: {change.from !== null && <>{change.from} → </>}
                    <span className="lh-to">{change.to}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ),
      }))}
    />
  )
}
