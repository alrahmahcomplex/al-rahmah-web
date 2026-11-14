import { Note, Tag } from "@/components/kit"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadFollowUps, listContactStaff, type FollowUp, type FollowUpRecord } from "@/lib/services/follow-ups"
import { isLeadClosed, type DeclinedReason } from "@/lib/services/lead-closure"
import { createClient } from "@/utils/supabase/server"

import { FollowUpActions } from "./follow-up-dialogs"
import { dueLabel } from "./follow-up-outcome"
import { enteredLate, formatContactTime, recordOutcomeText } from "./follow-up-record-format"

// The lead's Follow-ups panel: the open follow-up's date and note, or "No
// follow-up scheduled", every recorded contact newest first, and every
// earlier date with the reason it moved. Staff who hold follow_ups.record get
// Schedule follow-up, Record follow-up and Change date on an open lead. A
// closed lead shows its follow-ups with no actions. Whether the lead is
// closed is the database's answer (lead_is_closed), the check its follow-up
// writes make too; if that can't be read, the panel offers no actions. A lead
// reopened after a decline that has no follow-up date yet says so at the
// top, until one is planned or the lead becomes Enrolled (#95).
export async function FollowUpSection({
  leadId,
  canRecord,
  declineReasons = null,
  enrolled = false,
  staff,
}: {
  leadId: string
  // Holds follow_ups.record.
  canRecord: boolean
  // The Declined reasons this staff member may pick when the family will not
  // proceed; null without leads.decline, which leaves that outcome off.
  declineReasons?: readonly DeclinedReason[] | null
  enrolled?: boolean
  // The signed-in staff member, the default for who made a contact.
  staff?: { id: string; name: string }
}) {
  const supabase = await createClient()
  const [followUps, closed, contactStaff] = await Promise.all([
    getLeadFollowUps(supabase, leadId),
    isLeadClosed(supabase, leadId),
    canRecord ? listContactStaff(supabase) : null,
  ])
  const open = closed.ok && !closed.data
  const today = tanzaniaToday()

  return (
    <section aria-labelledby="lead-follow-ups" className="lr-card">
      <h2 id="lead-follow-ups" className="kit-card-title">
        Follow-ups
      </h2>
      {!followUps.ok ? (
        <Note tone="bad">The follow-ups could not be loaded. Try again in a moment.</Note>
      ) : (
        <div className="flex flex-col gap-4">
          {followUps.data.needsDate && (
            // A standing notice, not an announcement: the panel's status
            // messages stay the only live region.
            <Note tone="wait" role="note">
              <b>Reopened: set the next follow-up date</b>
            </Note>
          )}
          {followUps.data.open ? (
            <OpenFollowUp followUp={followUps.data.open} today={today} leadOpen={open} />
          ) : (
            <p className="lr-quiet">No follow-up scheduled.</p>
          )}
          {open && canRecord && staff && (
            <FollowUpActions
              key={leadId}
              leadId={leadId}
              today={today}
              current={followUps.data.open ? { id: followUps.data.open.id, dueOn: followUps.data.open.dueOn } : null}
              enrolled={enrolled}
              declineReasons={declineReasons}
              signedIn={staff}
              contactStaff={contactStaff?.ok ? contactStaff.data : null}
            />
          )}
          {followUps.data.records.length > 0 && (
            <Records records={followUps.data.records} followUps={[followUps.data.open, ...followUps.data.earlier]} />
          )}
          <EarlierDates earlier={followUps.data.earlier} all={[followUps.data.open, ...followUps.data.earlier]} />
        </div>
      )}
    </section>
  )
}

function OpenFollowUp({ followUp, today, leadOpen }: { followUp: FollowUp; today: string; leadOpen: boolean }) {
  const due = dueLabel(followUp.dueOn, today)
  return (
    <div className="flex flex-col gap-2">
      <p className="lr-quiet">{leadOpen ? "Next follow-up" : "Last planned follow-up"}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="lr-strong lr-num text-lg" aria-label="Follow-up date">
          {formatDate(followUp.dueOn)}
        </p>
        {/* A closed lead is not chased, so its date is neither due nor late. */}
        {leadOpen && <Tag tone={due.overdue ? "bad" : "line"}>{due.text}</Tag>}
      </div>
      <p className="lr-text lr-pre">
        {followUp.note ?? <span className="lr-quiet">No note.</span>}
      </p>
    </div>
  )
}

// Every contact recorded on the lead, newest first: what was said, how, who
// made it and when, when it was entered if that was over an hour later, and
// how it ended.
function Records({ records, followUps }: { records: FollowUpRecord[]; followUps: (FollowUp | null)[] }) {
  const dueOn = new Map(followUps.filter((f) => f !== null).map((f) => [f.id, f.dueOn]))
  return (
    <div className="lr-part">
      <h3 id="lead-follow-up-records" className="lr-sub">
        Contacts
      </h3>
      <ol aria-labelledby="lead-follow-up-records" className="lr-list">
        {records.map((record) => (
          <li key={record.id} className="flex flex-col gap-1">
            {record.kind === "contact" ? (
              <>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="lr-strong">
                    {record.method} by {record.contactedBy?.name ?? "a former staff member"}
                  </span>
                  {record.followUpId === null && <Tag tone="line">Unplanned</Tag>}
                </p>
                {record.followUpId && dueOn.get(record.followUpId) && (
                  <p className="lr-hint">Planned for {formatDate(dueOn.get(record.followUpId)!)}</p>
                )}
                {record.contactedAt && (
                  <p className="lr-hint">
                    <time dateTime={record.contactedAt}>{formatContactTime(record.contactedAt)}</time>
                    {enteredLate(record) && (
                      <>
                        {" · Entered "}
                        <time dateTime={record.enteredAt}>{formatContactTime(record.enteredAt)}</time>
                      </>
                    )}
                  </p>
                )}
                <p className="lr-text lr-pre">{record.comment}</p>
              </>
            ) : (
              // A follow-up that closed with its lead: the date it was planned
              // for, and when the lead closed.
              <>
                {record.followUpId && dueOn.get(record.followUpId) && (
                  <p className="lr-strong">Planned for {formatDate(dueOn.get(record.followUpId)!)}</p>
                )}
                <p className="lr-hint">
                  <time dateTime={record.enteredAt}>{formatContactTime(record.enteredAt)}</time>
                </p>
              </>
            )}
            <p className="lr-small">
              {recordOutcomeText(record, record.nextFollowUpId ? (dueOn.get(record.nextFollowUpId) ?? null) : null)}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}

// Each date the plan moved from, newest first, with the reason it moved. A
// follow-up a contact completed shows with its contact instead.
function EarlierDates({ earlier, all }: { earlier: FollowUp[]; all: (FollowUp | null)[] }) {
  const replacement = new Map(all.filter((f) => f?.replacesId).map((f) => [f!.replacesId!, f!]))
  const moved = earlier.filter((followUp) => replacement.has(followUp.id))
  if (moved.length === 0) return null
  return (
    <div className="lr-part">
      <h3 className="lr-sub">Earlier dates</h3>
      <ul className="lr-list">
        {moved.map((followUp) => {
          const next = replacement.get(followUp.id)
          return (
            <li key={followUp.id} className="flex flex-col gap-0.5">
              <span className="lr-text">
                <span className="line-through">{formatDate(followUp.dueOn)}</span>
                {next && <> moved to {formatDate(next.dueOn)}</>}
              </span>
              {next?.changeReason && <span className="lr-small break-words">Reason: {next.changeReason}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
