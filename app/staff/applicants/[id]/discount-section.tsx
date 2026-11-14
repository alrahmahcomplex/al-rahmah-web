import { Note, Tag } from "@/components/kit"
import { DISCOUNT_KINDS, getLeadDiscounts, type DiscountRequest } from "@/lib/services/discounts"
import { getPriorSibling } from "@/lib/services/sibling-groups"
import { createClient } from "@/utils/supabase/server"

import { DecideDiscount } from "./decide-discount"
import { canDecideDiscount, canRequestDiscount, DISCOUNT_STATE_LABELS, discountLabel } from "./discount-outcome"
import type { LeadPanelProps } from "./panels"
import { PriorSiblingTick } from "./prior-sibling"
import { RequestDiscount } from "./request-discount"
import { dayOf } from "./reopening-outcome"

// The lead's Staff child and Qualified orphan discounts (#112): the Pending
// request with who raised it and when, Grant and Refuse for the Admissions
// Manager, Request discount for staff who may edit leads while nothing is
// Pending, and every decided request, a refusal with its reason. A closed
// lead keeps showing them, with no actions. A lead with no request shows
// nothing to staff who can't request one.
//
// The prior-sibling tick (#113) sits at the top, for staff who may edit
// leads, and for everyone once it is ticked.
export async function DiscountSection({ lead, staff, open }: LeadPanelProps) {
  const supabase = await createClient()
  const [discounts, priorSibling] = await Promise.all([getLeadDiscounts(supabase, lead.id), getPriorSibling(supabase, lead.id)])
  const mayRequest = open && canRequestDiscount(staff.permissions)
  const mayDecide = canDecideDiscount(staff.permissions)
  const sibling = priorSibling.ok ? priorSibling.data : null
  if (discounts.ok && priorSibling.ok && !discounts.data.pending && discounts.data.decided.length === 0 && !mayRequest && !sibling) {
    return null
  }

  const granted = discounts.ok ? discounts.data.decided.filter((request) => request.state === "granted").map((r) => r.kind) : []
  const requestable = DISCOUNT_KINDS.filter((kind) => !granted.includes(kind))

  return (
    <section aria-labelledby="lead-discounts" className="lr-card">
      <h2 id="lead-discounts" className="kit-card-title">
        Discounts
      </h2>
      {!discounts.ok ? (
        <Note tone="bad">The discounts could not be loaded. Try again in a moment.</Note>
      ) : (
        <div className="flex flex-col gap-4">
          {!priorSibling.ok ? (
            // Unread, the tick could show unticked over a saved sibling, so
            // nothing about it shows until it loads.
            <Note tone="bad">Has a sibling already at Al-Rahmah could not be loaded. Try again in a moment.</Note>
          ) : (
            (sibling || mayRequest) && (
              <div className="border-b border-gf-mist pb-4">
                <PriorSiblingTick leadId={lead.id} sibling={sibling} canEdit={mayRequest} />
              </div>
            )
          )}
          {discounts.data.pending ? (
            <PendingRequest
              request={discounts.data.pending}
              mine={discounts.data.pending.requestedById === staff.id}
              decide={
                mayDecide && open ? (
                  <DecideDiscount
                    leadId={lead.id}
                    requestId={discounts.data.pending.id}
                    studentName={lead.studentName}
                    admissionNumber={lead.admissionNumber}
                    discount={discountLabel(discounts.data.pending.kind)}
                    canGrant
                  />
                ) : null
              }
            />
          ) : discounts.data.decided.length === 0 ? (
            <p className="lr-quiet">No Staff child or Qualified orphan discount requested.</p>
          ) : null}
          {!discounts.data.pending && mayRequest && requestable.length > 0 && (
            <RequestDiscount leadId={lead.id} kinds={requestable} />
          )}
          {discounts.data.decided.length > 0 && (
            <div className={discounts.data.pending ? "lr-part" : "flex flex-col gap-3"}>
              <h3 className="lr-sub">Decided requests</h3>
              <ul className="lr-list">
                {discounts.data.decided.map((request) => (
                  <DecidedRequest key={request.id} request={request} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function PendingRequest({ request, mine, decide }: { request: DiscountRequest; mine: boolean; decide: React.ReactNode }) {
  return (
    <div role="group" className="flex flex-col gap-2" aria-label="Pending discount request">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Tag tone="wait">{DISCOUNT_STATE_LABELS.pending}</Tag>
        <p className="lr-text lr-strong">{discountLabel(request.kind)}</p>
      </div>
      <p className="lr-hint">
        Requested by {mine ? "you" : (request.requestedBy ?? "a staff member")} on {dayOf(request.requestedAt)}. Waiting for the
        Admissions Manager.
      </p>
      <p className="lr-text lr-pre">{request.note}</p>
      {decide}
    </div>
  )
}

function DecidedRequest({ request }: { request: DiscountRequest }) {
  const decided = `${DISCOUNT_STATE_LABELS[request.state]}${request.decidedBy ? ` by ${request.decidedBy}` : ""}${
    request.decidedAt ? ` on ${dayOf(request.decidedAt)}` : ""
  }`
  return (
    <li className="flex flex-col gap-0.5">
      <span className="lr-strong">{discountLabel(request.kind)}</span>
      <span>{decided}</span>
      {request.refusalReason && (
        <span className="lr-pre">Reason for refusing: {request.refusalReason}</span>
      )}
      <span className="lr-hint">
        Requested by {request.requestedBy ?? "a staff member"} on {dayOf(request.requestedAt)}
      </span>
      <span className="lr-small lr-pre">{request.note}</span>
    </li>
  )
}
