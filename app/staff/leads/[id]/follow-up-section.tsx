import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadFollowUps, listContactStaff, type FollowUp, type FollowUpRecord } from "@/lib/services/follow-ups"
import { createClient } from "@/utils/supabase/server"

import { FollowUpActions } from "./follow-up-dialogs"
import { dueLabel } from "./follow-up-outcome"
import { enteredLate, formatContactTime, recordOutcomeText } from "./follow-up-record-format"

// The lead's Follow-ups panel: the open follow-up's date and note, or "No
// follow-up scheduled", every recorded contact newest first, and every
// earlier date with the reason it moved. Staff who hold follow_ups.record get
// Schedule follow-up, Record follow-up and Change date on an open lead. A
// closed lead shows its follow-ups with no actions.
export async function FollowUpSection({
  leadId,
  open,
  canRecord,
  enrolled = false,
  staff,
}: {
  leadId: string
  open: boolean
  canRecord: boolean
  enrolled?: boolean
  // The signed-in staff member, the default for who made a contact.
  staff?: { id: string; name: string }
}) {
  const supabase = await createClient()
  const [followUps, contactStaff] = await Promise.all([
    getLeadFollowUps(supabase, leadId),
    canRecord ? listContactStaff(supabase) : null,
  ])
  const today = tanzaniaToday()

  return (
    <section aria-labelledby="lead-follow-ups" className="flex flex-col gap-3">
      <h2 id="lead-follow-ups" className="text-sm font-semibold text-slate-900">
        Follow-ups
      </h2>
      {!followUps.ok ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription>The follow-ups could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <div className="flex max-w-xl flex-col gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
          {followUps.data.open ? (
            <OpenFollowUp followUp={followUps.data.open} today={today} leadOpen={open} />
          ) : (
            <p className="text-sm text-muted-foreground">No follow-up scheduled.</p>
          )}
          {canRecord && staff && (
            <FollowUpActions
              key={leadId}
              leadId={leadId}
              today={today}
              current={followUps.data.open ? { id: followUps.data.open.id, dueOn: followUps.data.open.dueOn } : null}
              enrolled={enrolled}
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
      <p className="text-sm text-muted-foreground">{leadOpen ? "Next follow-up" : "Last planned follow-up"}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-lg font-semibold text-slate-900" aria-label="Follow-up date">
          {formatDate(followUp.dueOn)}
        </p>
        {/* A closed lead is not chased, so its date is neither due nor late. */}
        {leadOpen && <Badge variant={due.overdue ? "destructive" : "secondary"}>{due.text}</Badge>}
      </div>
      <p className="text-sm break-words whitespace-pre-line text-slate-900">
        {followUp.note ?? <span className="text-muted-foreground">No note.</span>}
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
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 id="lead-follow-up-records" className="text-xs font-medium text-muted-foreground">
        Contacts
      </h3>
      <ol aria-labelledby="lead-follow-up-records" className="flex flex-col divide-y">
        {records.map((record) => (
          <li key={record.id} className="flex flex-col gap-1 py-2 text-sm first:pt-0 last:pb-0">
            {record.kind === "contact" ? (
              <>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-slate-900">
                    {record.method} by {record.contactedBy?.name ?? "a former staff member"}
                  </span>
                  {record.followUpId === null && <Badge variant="outline">Unplanned</Badge>}
                </p>
                {record.followUpId && dueOn.get(record.followUpId) && (
                  <p className="text-xs text-muted-foreground">Planned for {formatDate(dueOn.get(record.followUpId)!)}</p>
                )}
                {record.contactedAt && (
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={record.contactedAt}>{formatContactTime(record.contactedAt)}</time>
                    {enteredLate(record) && (
                      <>
                        {" · Entered "}
                        <time dateTime={record.enteredAt}>{formatContactTime(record.enteredAt)}</time>
                      </>
                    )}
                  </p>
                )}
                <p className="break-words whitespace-pre-line text-slate-900">{record.comment}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                <time dateTime={record.enteredAt}>{formatContactTime(record.enteredAt)}</time>
              </p>
            )}
            <p className="text-xs text-slate-700">
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
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">Earlier dates</h3>
      <ul className="flex flex-col gap-2 text-sm">
        {moved.map((followUp) => {
          const next = replacement.get(followUp.id)
          return (
            <li key={followUp.id} className="flex flex-col gap-0.5">
              <span className="text-slate-900">
                <span className="line-through decoration-slate-400">{formatDate(followUp.dueOn)}</span>
                {next && <> moved to {formatDate(next.dueOn)}</>}
              </span>
              {next?.changeReason && <span className="break-words text-xs text-muted-foreground">Reason: {next.changeReason}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
