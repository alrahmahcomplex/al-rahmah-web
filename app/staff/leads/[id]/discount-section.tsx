import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { DISCOUNT_KINDS, getLeadDiscounts, type DiscountRequest } from "@/lib/services/discounts"
import { createClient } from "@/utils/supabase/server"

import { DecideDiscount } from "./decide-discount"
import { canDecideDiscount, canRequestDiscount, DISCOUNT_STATE_LABELS, discountLabel } from "./discount-outcome"
import type { LeadPanelProps } from "./panels"
import { RequestDiscount } from "./request-discount"
import { dayOf } from "./reopening-outcome"

// The lead's Staff child and Qualified orphan discounts (#112): the Pending
// request with who raised it and when, Grant and Refuse for the Admissions
// Manager, Request discount for staff who may edit leads while nothing is
// Pending, and every decided request, a refusal with its reason. A closed
// lead keeps showing them, with no actions. A lead with no request shows
// nothing to staff who can't request one.
export async function DiscountSection({ lead, staff, open }: LeadPanelProps) {
  const discounts = await getLeadDiscounts(await createClient(), lead.id)
  const mayRequest = open && canRequestDiscount(staff.permissions)
  const mayDecide = canDecideDiscount(staff.permissions)
  if (discounts.ok && !discounts.data.pending && discounts.data.decided.length === 0 && !mayRequest) return null

  const granted = discounts.ok ? discounts.data.decided.filter((request) => request.state === "granted").map((r) => r.kind) : []
  const requestable = DISCOUNT_KINDS.filter((kind) => !granted.includes(kind))

  return (
    <section aria-labelledby="lead-discounts" className="flex flex-col gap-3">
      <h2 id="lead-discounts" className="text-sm font-semibold text-slate-900">
        Discounts
      </h2>
      {!discounts.ok ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription>The discounts could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <div className="flex max-w-xl flex-col gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
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
            <p className="text-sm text-muted-foreground">No Staff child or Qualified orphan discount requested.</p>
          ) : null}
          {!discounts.data.pending && mayRequest && requestable.length > 0 && (
            <RequestDiscount leadId={lead.id} kinds={requestable} />
          )}
          {discounts.data.decided.length > 0 && (
            <div className={discounts.data.pending ? "flex flex-col gap-2 border-t pt-3" : "flex flex-col gap-2"}>
              <h3 className="text-xs font-medium text-muted-foreground">Decided requests</h3>
              <ul className="flex flex-col gap-3 text-sm">
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
        <Badge variant="secondary">{DISCOUNT_STATE_LABELS.pending}</Badge>
        <p className="text-sm font-medium text-slate-900">{discountLabel(request.kind)}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Requested by {mine ? "you" : (request.requestedBy ?? "a staff member")} on {dayOf(request.requestedAt)}. Waiting for the
        Admissions Manager.
      </p>
      <p className="text-sm break-words whitespace-pre-line text-slate-900">{request.note}</p>
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
      <span className="font-medium text-slate-900">{discountLabel(request.kind)}</span>
      <span className="text-slate-900">{decided}</span>
      {request.refusalReason && (
        <span className="break-words whitespace-pre-line text-slate-900">Reason for refusing: {request.refusalReason}</span>
      )}
      <span className="text-xs text-muted-foreground">
        Requested by {request.requestedBy ?? "a staff member"} on {dayOf(request.requestedAt)}
      </span>
      <span className="break-words whitespace-pre-line text-xs text-muted-foreground">{request.note}</span>
    </li>
  )
}
