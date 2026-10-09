import Link from "next/link"
import { cache, type ReactNode } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { getLeadClosure } from "@/lib/services/lead-closure"
import type { Lead } from "@/lib/services/leads"
import { getLeadReopenings, needsRetakeChoice, type ReopeningRequest } from "@/lib/services/reopening-requests"
import { seatCheck } from "@/lib/services/seats"
import { createClient } from "@/utils/supabase/server"

import { DecideReopening } from "./decide-reopening"
import type { LeadPanelProps } from "./panels"
import { approvalConsequence, approvalSeats, canDecideReopening, retakeChoiceText } from "./reopening-decision-outcome"
import { canRaiseReopening, dayOf, SOURCE_LABELS, STATE_LABELS } from "./reopening-outcome"
import { WithdrawReopening } from "./withdraw-reopening"

// Read once per page render: the closed-lead banner and this panel both ask.
const readReopenings = cache(async (leadId: string) => getLeadReopenings(await createClient(), leadId))

// Request reopening, for the closed-lead banner, while nobody has asked yet.
// With a Pending request the panel below says who asked instead. If the
// requests can't be read, one may already be Pending, so nothing is offered;
// the panel reports the error.
export async function RequestReopeningLink({ leadId }: { leadId: string }) {
  const reopenings = await readReopenings(leadId)
  if (!reopenings.ok || reopenings.data.pending) return null
  return (
    <div>
      <Link href={`/staff/leads/${leadId}/reopen?source=lead`} className={buttonVariants({ size: "sm" })}>
        Request reopening
      </Link>
    </div>
  )
}

// The lead's Reopening requests: the Pending one, with Withdraw for the staff
// member who raised it and Approve and Reject for approvers (#101, an
// exception recorded in docs/agents/parallel-work.md), and every earlier one
// with its outcome. Shown on a closed lead, and on an open one that was
// reopened before. A lead that was never asked about shows nothing; its
// banner offers Request reopening.
export async function ReopeningSection({ lead, staff }: LeadPanelProps) {
  const reopenings = await readReopenings(lead.id)
  if (reopenings.ok && !reopenings.data.pending && reopenings.data.decided.length === 0) return null

  return (
    <section aria-labelledby="lead-reopenings" className="flex flex-col gap-3">
      <h2 id="lead-reopenings" className="text-sm font-semibold text-slate-900">
        Reopening requests
      </h2>
      {!reopenings.ok ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription>The reopening requests could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <div className="flex max-w-xl flex-col gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
          {reopenings.data.pending && (
            <PendingRequest
              request={reopenings.data.pending}
              mine={reopenings.data.pending.requestedById === staff.id}
              canWithdraw={canRaiseReopening(staff.permissions)}
              leadId={lead.id}
              decide={canDecideReopening(staff.permissions) ? <Decide lead={lead} requestId={reopenings.data.pending.id} /> : null}
            />
          )}
          {reopenings.data.decided.length > 0 && (
            <div className={reopenings.data.pending ? "flex flex-col gap-2 border-t pt-3" : "flex flex-col gap-2"}>
              <h3 className="text-xs font-medium text-muted-foreground">Earlier requests</h3>
              <ul className="flex flex-col gap-3 text-sm">
                {reopenings.data.decided.map((request) => (
                  <EarlierRequest key={request.id} request={request} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function PendingRequest({
  request,
  mine,
  canWithdraw,
  leadId,
  decide,
}: {
  request: ReopeningRequest
  mine: boolean
  canWithdraw: boolean
  leadId: string
  // Approve and Reject, for approvers.
  decide: ReactNode
}) {
  return (
    <div role="group" className="flex flex-col gap-2" aria-label="Pending reopening request">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant="secondary">{STATE_LABELS.pending}</Badge>
        <p className="text-sm text-slate-900">
          Requested by {mine ? "you" : request.requestedBy} on {dayOf(request.requestedAt)}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">From the {SOURCE_LABELS[request.source].toLowerCase()}. Waiting for a Manager.</p>
      <p className="text-sm break-words whitespace-pre-line text-slate-900">{request.reason}</p>
      {mine && canWithdraw && (
        <div>
          <WithdrawReopening leadId={leadId} requestId={request.id} />
        </div>
      )}
      {decide}
    </div>
  )
}

// Approve and Reject, with what approving does to this lead and, when it
// would take a seat in a full class, slice 9's seat warning and ranking
// (#103). The retake choice is asked when the lead was declined from
// Interviewed or Enrolled. The seat check only advises, so a failed one
// never holds back Approve.
async function Decide({ lead, requestId }: { lead: Lead; requestId: string }) {
  const supabase = await createClient()
  const [closure, seats] = await Promise.all([
    getLeadClosure(supabase, lead.id),
    // A thrown request counts as a failed check, never as a broken panel.
    seatCheck(supabase, lead.id).catch(() => ({ ok: false, error: "unavailable" }) as const),
  ])
  if (!closure.ok) {
    return <p className="text-sm text-destructive">Approve and Reject could not be loaded. Reload the page to try again.</p>
  }
  const statusBefore = closure.data.decline?.statusBefore ?? null
  return (
    <DecideReopening
      leadId={lead.id}
      requestId={requestId}
      studentName={lead.studentName}
      admissionNumber={lead.admissionNumber}
      consequence={approvalConsequence({ status: lead.status, closure: lead.closure, statusBefore, visitDate: lead.visitDate })}
      askRetake={lead.status === "Declined" && needsRetakeChoice(statusBefore)}
      seats={approvalSeats(seats)}
    />
  )
}

function EarlierRequest({ request }: { request: ReopeningRequest }) {
  const decided = request.decidedAt ? ` on ${dayOf(request.decidedAt)}` : ""
  const outcome =
    request.state === "withdrawn"
      ? `Withdrawn by ${request.decidedBy ?? request.requestedBy}${decided}`
      : `${STATE_LABELS[request.state]}${request.decidedBy ? ` by ${request.decidedBy}` : ""}${decided}`

  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-slate-900">{outcome}</span>
      {request.state === "approved" && <ApprovedEffect request={request} />}
      <span className="text-xs text-muted-foreground">
        Requested by {request.requestedBy} on {dayOf(request.requestedAt)}
      </span>
      <span className="break-words whitespace-pre-line text-slate-900">{request.reason}</span>
      {request.rejectionReason && (
        <span className="break-words whitespace-pre-line text-xs text-muted-foreground">
          Reason for rejecting: {request.rejectionReason}
        </span>
      )}
    </li>
  )
}

// What an approval did: the status the lead came back with, and the retake
// choice when it applied.
function ApprovedEffect({ request }: { request: ReopeningRequest }) {
  const retake = retakeChoiceText(request.enrolWithoutRetake)
  const restored = request.leadWasDeclined
    ? `Reopened from Declined as ${request.restoredStatus}`
    : `Reopened as ${request.restoredStatus}`
  return (
    <span className="text-xs text-muted-foreground">
      {restored}
      {retake ? `. ${retake}.` : "."}
    </span>
  )
}
