import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { listPendingDiscountRequests } from "@/lib/services/discounts"
import { createClient } from "@/utils/supabase/server"

import { DecideDiscount } from "../leads/[id]/decide-discount"
import { canDecideDiscount, discountLabel } from "../leads/[id]/discount-outcome"
import { dayOf } from "../leads/[id]/reopening-outcome"
import { requireStaff } from "../session"

export const metadata: Metadata = {
  title: "Discount requests · Al-Rahmah Complex",
}

// Every Pending Staff child and Qualified orphan request, oldest first, for
// the Admissions Manager to grant or refuse (#112). A request on a lead that
// was closed since can only be refused until the lead is reopened.
export default async function DiscountRequestsPage() {
  const staff = await requireStaff()
  if (!canDecideDiscount(staff.permissions)) forbidden()

  const requests = await listPendingDiscountRequests(await createClient())

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Discount requests</h1>
        <p className="text-sm text-muted-foreground">
          Staff child and Qualified orphan discounts waiting for a decision, oldest first. Check the supporting documents outside the
          system.
        </p>
      </div>

      {!requests.ok ? (
        <Alert variant="destructive">
          <AlertDescription>Discount requests could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : requests.data.length === 0 ? (
        <p className="text-sm text-slate-700">No discount requests are waiting.</p>
      ) : (
        <ol aria-label="Pending discount requests" className="flex max-w-3xl flex-col gap-3">
          {requests.data.map((request) => (
            <li
              key={request.id}
              aria-label={`${request.admissionNumber} ${request.studentName}`}
              className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link
                  href={`/staff/leads/${request.leadId}`}
                  className="font-mono text-sm font-medium text-blue-600 underline-offset-4 hover:underline"
                >
                  {request.admissionNumber}
                </Link>
                <span className="text-sm font-medium text-slate-900">{request.studentName}</span>
                <span className="text-xs text-muted-foreground">
                  {request.className} {request.dayOrBoarding}, {request.enrollmentYear}
                </span>
              </div>
              <p className="text-sm font-medium text-slate-900">{discountLabel(request.kind)}</p>
              <p className="text-xs text-muted-foreground">
                Requested by {request.requestedBy ?? "a staff member"} on {dayOf(request.requestedAt)}
              </p>
              <p className="text-sm break-words whitespace-pre-line text-slate-900">{request.note}</p>
              {!request.leadOpen && (
                <p className="text-sm text-slate-700">This lead is closed. It can be granted only after it is reopened.</p>
              )}
              <DecideDiscount
                leadId={request.leadId}
                requestId={request.id}
                studentName={request.studentName}
                admissionNumber={request.admissionNumber}
                discount={discountLabel(request.kind)}
                canGrant={request.leadOpen}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
