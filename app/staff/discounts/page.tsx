import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { Card, EmptyState, ListRow, Note, PageHeader, pageTitle, Tag } from "@/components/kit"
import { listPendingDiscountRequests } from "@/lib/services/discounts"
import { createClient } from "@/utils/supabase/server"

import { canDecideDiscount, DISCOUNT_STATE_LABELS, discountLabel } from "../applicants/[id]/discount-outcome"
import { dayOf } from "../applicants/[id]/reopening-outcome"
import { leadTabHref } from "../applicants/[id]/tabs"
import { requireStaff } from "../session"
import { ReviewDiscount } from "./review-discount"
import "./discounts.css"

export const metadata: Metadata = {
  title: pageTitle("Discount requests"),
}

// Every Pending Staff child and Qualified orphan request, oldest first, for
// the Admissions Manager to grant or refuse (#112). A request on a lead that
// was closed since can only be refused until the lead is reopened. Each row
// opens a review sheet with the decision (#327). Drawn in the new shell.
export default async function DiscountRequestsPage() {
  const staff = await requireStaff()
  if (!canDecideDiscount(staff.permissions)) forbidden()

  const requests = await listPendingDiscountRequests(await createClient())

  return (
    <>
      <PageHeader
        title="Discount requests"
        subtitle="Staff child and Qualified orphan discounts waiting for a decision, oldest first. Check the supporting documents outside the system."
      />
      {!requests.ok ? (
        <Note tone="bad" role="alert">
          Discount requests could not be loaded. Try again in a moment.
        </Note>
      ) : (
        <Card>
          {requests.data.length === 0 ? (
            <EmptyState illustration="inbox" title="No discount requests are waiting." />
          ) : (
            <ol aria-label="Pending discount requests" className="dr-list">
              {requests.data.map((request) => {
                const discount = discountLabel(request.kind)
                const requestedByOn = `${request.requestedBy ?? "a staff member"} on ${dayOf(request.requestedAt)}`
                return (
                  <li key={request.id} aria-label={`${request.admissionNumber} ${request.studentName}`}>
                    <ListRow
                      icon="discounts"
                      title={`${request.studentName} · ${discount}`}
                      caption={
                        <span className="dr-cap">
                          <span className="dr-why">{request.note}</span>
                          <span className="dr-by">· Requested by {requestedByOn}</span>
                        </span>
                      }
                      trailing={
                        <span className="dr-end">
                          <Tag tone="wait">{DISCOUNT_STATE_LABELS.pending}</Tag>
                          <ReviewDiscount
                            leadId={request.leadId}
                            requestId={request.id}
                            studentName={request.studentName}
                            admissionNumber={request.admissionNumber}
                            leadHref={leadTabHref(request.leadId, "discounts", "lead-discounts")}
                            discount={discount}
                            place={`${request.className} ${request.dayOrBoarding}, ${request.enrollmentYear}`}
                            note={request.note}
                            requestedByOn={requestedByOn}
                            canGrant={request.leadOpen}
                          />
                        </span>
                      }
                    />
                  </li>
                )
              })}
            </ol>
          )}
        </Card>
      )}
    </>
  )
}
