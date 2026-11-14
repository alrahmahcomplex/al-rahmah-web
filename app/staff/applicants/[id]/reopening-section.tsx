import type { ReactNode } from "react"

import { ButtonLink, Note, Tag } from "@/components/kit"
import { getLeadClosure } from "@/lib/services/lead-closure"
import type { Lead } from "@/lib/services/leads"
import { needsRetakeChoice, type ReopeningRequest } from "@/lib/services/reopening-requests"
import { seatCheck } from "@/lib/services/seats"
import { createClient } from "@/utils/supabase/server"

import { DecideReopening } from "./decide-reopening"
import { readReopenings } from "./lead-reads"
import type { LeadPanelProps } from "./panels"
import { approvalConsequence, approvalSeats, canDecideReopening, retakeChoiceText } from "./reopening-decision-outcome"
import { canRaiseReopening, dayOf, SOURCE_LABELS, STATE_LABELS } from "./reopening-outcome"
import { WithdrawReopening } from "./withdraw-reopening"

// Whether Request reopening may be offered on the lead: no request is
// Pending, as far as the requests can be read.
export async function nobodyHasAsked(leadId: string): Promise<boolean> {
  const reopenings = await readReopenings(leadId)
  return reopenings.ok && !reopenings.data.pending
}

// Request reopening, for the closed-lead banner, while nobody has asked yet.
// With a Pending request the panel below says who asked instead. If the
// requests can't be read, one may already be Pending, so nothing is offered;
// the panel reports the error.
export async function RequestReopeningLink({ leadId }: { leadId: string }) {
  if (!(await nobodyHasAsked(leadId))) return null
  return (
    <div>
      <ButtonLink href={`/staff/applicants/${leadId}/reopen?source=lead`} size="small" chevron>
        Request reopening
      </ButtonLink>
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
    <section aria-labelledby="lead-reopenings" className="lr-card">
      <h2 id="lead-reopenings" className="kit-card-title">
        Reopening requests
      </h2>
      {!reopenings.ok ? (
        <Note tone="bad">The reopening requests could not be loaded. Try again in a moment.</Note>
      ) : (
        <div className="flex flex-col gap-4">
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
            <div className={reopenings.data.pending ? "lr-part" : "flex flex-col gap-3"}>
              <h3 className="lr-sub">Earlier requests</h3>
              <ul className="lr-list">
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
        <Tag tone="wait">{STATE_LABELS.pending}</Tag>
        <p className="lr-text">
          Requested by {mine ? "you" : request.requestedBy} on {dayOf(request.requestedAt)}
        </p>
      </div>
      <p className="lr-hint">From the {SOURCE_LABELS[request.source].toLowerCase()}. Waiting for a Manager.</p>
      <p className="lr-text lr-pre">{request.reason}</p>
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
    return <p className="lr-error">Approve and Reject could not be loaded. Reload the page to try again.</p>
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
      <span className="lr-strong">{outcome}</span>
      {request.state === "approved" && <ApprovedEffect request={request} />}
      <span className="lr-hint">
        Requested by {request.requestedBy} on {dayOf(request.requestedAt)}
      </span>
      <span className="lr-pre">{request.reason}</span>
      {request.rejectionReason && (
        <span className="lr-small lr-pre">
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
    <span className="lr-hint">
      {restored}
      {retake ? `. ${retake}.` : "."}
    </span>
  )
}
