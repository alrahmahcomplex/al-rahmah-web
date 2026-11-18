import type { Metadata } from "next"

import { Card, EmptyState, ListRow, Note, PageHeader, pageTitle, Tag } from "@/components/kit"
import { listPendingDiscountRequests } from "@/lib/services/discounts"
import { listPendingSiblingRequests } from "@/lib/services/sibling-requests"
import { firstName } from "@/lib/sibling-group-view"
import { tanzaniaToday } from "@/lib/school-calendar"
import { createClient } from "@/utils/supabase/server"

import { canDecideDiscount, DISCOUNT_STATE_LABELS, discountLabel } from "../applicants/[id]/discount-outcome"
import { dayOf } from "../applicants/[id]/reopening-outcome"
import { daysBetween } from "../applicants/[id]/sibling-read"
import { leadTabHref } from "../applicants/[id]/tabs"
import StaffForbidden from "../forbidden"
import { requireStaff } from "../session"
import { ReviewDiscount } from "./review-discount"
import { ReviewSibling } from "./review-sibling"
import "./discounts.css"

export const metadata: Metadata = {
  title: pageTitle("Discount requests"),
}

// Every Pending Sibling request, then every Pending Staff child and
// Qualified orphan request, oldest first, for the Admissions Manager to grant
// or refuse (#112, #310). A request on a lead that
// was closed since can only be refused until the lead is reopened. Each row
// opens a review sheet with the decision (#327). Drawn in the new shell.
export default async function DiscountRequestsPage() {
  const staff = await requireStaff()
  if (!canDecideDiscount(staff.permissions)) return <StaffForbidden />

  const supabase = await createClient()
  const [requests, siblingRequests] = await Promise.all([listPendingDiscountRequests(supabase), listPendingSiblingRequests(supabase)])
  const siblings = siblingRequests.ok ? siblingRequests.data : []
  const today = tanzaniaToday()

  return (
    <>
      <PageHeader
        title="Discount requests"
        subtitle="Sibling, Staff child and Qualified orphan discounts waiting for a decision, oldest first. Check the supporting documents outside the system."
      />
      {!siblingRequests.ok && (
        <Note tone="bad" role="alert">
          Sibling requests could not be loaded. Try again in a moment.
        </Note>
      )}
      {!requests.ok ? (
        <Note tone="bad" role="alert">
          Discount requests could not be loaded. Try again in a moment.
        </Note>
      ) : (
        <Card>
          {requests.data.length === 0 && siblings.length === 0 ? (
            <EmptyState illustration="inbox" title="No discount requests are waiting." />
          ) : (
            <ol aria-label="Pending discount requests" className="dr-list">
              {siblings.map((request) => {
                const waiting = daysBetween(tanzaniaToday(new Date(request.requestedAt)), today)
                const sibling = request.siblingOfLeadId
                  ? {
                      leadId: request.siblingOfLeadId,
                      firstName: firstName(request.siblingOfStudentName ?? ""),
                      studentName: request.siblingOfStudentName ?? "",
                      father: request.siblingOfFatherFullName,
                    }
                  : // A request inside one group names no sibling: the review sheet
                    // compares with the member the record would, once its preview reads the group.
                    null
                return (
                  <li key={request.id} aria-label={`${request.admissionNumber} ${request.studentName}`}>
                    <ListRow
                      icon="discounts"
                      title={`${request.studentName} · Sibling · 10%`}
                      caption={
                        <span className="dr-cap">
                          <span className="dr-why">Fathers’ names don’t match</span>
                          <span className="dr-by">
                            · {request.requestedBy ?? "a staff member"} · {waiting === 0 ? "today" : `waiting ${waiting} ${waiting === 1 ? "day" : "days"}`}
                            {request.status === "Enrolled" ? " · already Enrolled" : ""}
                          </span>
                        </span>
                      }
                      trailing={
                        <span className="dr-end">
                          {!request.leadOpen && <Tag tone="line">Closed</Tag>}
                          <Tag tone="wait">{DISCOUNT_STATE_LABELS.pending}</Tag>
                          <ReviewSibling
                            leadId={request.leadId}
                            studentName={request.studentName}
                            father={request.fatherFullName}
                            canGrant={request.leadOpen}
                            pending={{
                              requestId: request.id,
                              requestedBy: request.requestedBy ?? "a staff member",
                              requestedOn: dayOf(request.requestedAt),
                              waitingDays: waiting,
                              note: request.note,
                              sibling,
                            }}
                          />
                        </span>
                      }
                    />
                  </li>
                )
              })}
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
                          {!request.leadOpen && <Tag tone="line">Closed</Tag>}
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
