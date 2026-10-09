import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { listPendingReopeningRequests } from "@/lib/services/lead-closure"
import { createClient } from "@/utils/supabase/server"

import { canDecideReopening } from "../leads/[id]/reopening-decision-outcome"
import { SOURCE_LABELS } from "../leads/[id]/reopening-outcome"
import { when } from "../re-applications/format"
import { LeadBadges } from "../re-applications/lead-badges"
import { requireStaff } from "../session"

export const metadata: Metadata = {
  title: "Reopening requests · Al-Rahmah Complex",
}

// Every Pending Reopening request, oldest first, for approvers (#100). Each
// request links to its lead, where the approver reads the history and
// decides.
export default async function ReopeningRequestsPage() {
  const staff = await requireStaff()
  if (!canDecideReopening(staff.permissions)) forbidden()

  const requests = await listPendingReopeningRequests(await createClient())

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Reopening requests</h1>
        <p className="text-sm text-muted-foreground">
          Closed leads waiting for a decision, oldest first. Open a lead to approve or reject its request.
        </p>
      </div>

      {!requests.ok ? (
        <Alert variant="destructive">
          <AlertDescription>Reopening requests could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : requests.data.length === 0 ? (
        <p className="text-sm text-slate-700">No reopening requests are waiting.</p>
      ) : (
        <ol aria-label="Pending reopening requests" className="flex max-w-3xl flex-col gap-3">
          {requests.data.map((request) => (
            <li
              key={request.id}
              aria-label={`${request.admissionNumber} ${request.studentName}`}
              className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  href={`/staff/leads/${request.leadId}`}
                  className="font-mono text-sm font-medium text-blue-600 underline-offset-4 hover:underline"
                >
                  {request.admissionNumber}
                </Link>
                <span className="text-sm font-medium text-slate-900">{request.studentName}</span>
                <LeadBadges status={request.status} closure={request.closure} />
              </div>
              <p className="text-xs text-muted-foreground">
                Requested by {request.requestedBy ?? "a staff member"} on{" "}
                <time dateTime={request.requestedAt}>{when(request.requestedAt)}</time>. From the{" "}
                {SOURCE_LABELS[request.source].toLowerCase()}.
              </p>
              <p className="text-sm break-words whitespace-pre-line text-slate-900">{request.reason}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
