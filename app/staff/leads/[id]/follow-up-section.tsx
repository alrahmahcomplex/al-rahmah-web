import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadFollowUps, type FollowUp } from "@/lib/services/follow-ups"
import { createClient } from "@/utils/supabase/server"

import { FollowUpActions } from "./follow-up-dialogs"
import { dueLabel } from "./follow-up-outcome"

// The lead's Follow-ups panel: the open follow-up's date and note, or "No
// follow-up scheduled", and every earlier date with the reason it moved.
// Staff who hold follow_ups.record get Schedule follow-up or Change date on
// an open lead. A closed lead shows its follow-ups with no actions.
export async function FollowUpSection({ leadId, open, canRecord }: { leadId: string; open: boolean; canRecord: boolean }) {
  const followUps = await getLeadFollowUps(await createClient(), leadId)
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
          {canRecord && (
            <FollowUpActions
              key={leadId}
              leadId={leadId}
              today={today}
              current={followUps.data.open ? { id: followUps.data.open.id, dueOn: followUps.data.open.dueOn } : null}
            />
          )}
          {followUps.data.earlier.length > 0 && (
            <EarlierDates earlier={followUps.data.earlier} all={[followUps.data.open, ...followUps.data.earlier]} />
          )}
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

// Each date the plan moved from, newest first, with the reason it moved.
function EarlierDates({ earlier, all }: { earlier: FollowUp[]; all: (FollowUp | null)[] }) {
  const replacement = new Map(all.filter((f) => f?.replacesId).map((f) => [f!.replacesId!, f!]))
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">Earlier dates</h3>
      <ul className="flex flex-col gap-2 text-sm">
        {earlier.map((followUp) => {
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
