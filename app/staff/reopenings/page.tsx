import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { listPendingReopeningRequests } from "@/lib/services/lead-closure"
import { createClient } from "@/utils/supabase/server"

import { canDecideReopening } from "../leads/[id]/reopening-decision-outcome"
import { SOURCE_LABELS } from "../leads/[id]/reopening-outcome"
import { LeadBadges } from "../re-applications/lead-badges"
import { when } from "../re-applications/format"
import { requireStaff } from "../session"

export const metadata: Metadata = {
  title: "Reopening requests · Al-Rahmah Complex",
}

// Every Pending Reopening request, oldest first, for approvers (#100). Each
// row links to the lead, where the approver reads its history and decides.
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
        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <table aria-label="Pending reopening requests" className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Admission Number</th>
                <th scope="col" className="px-3 py-2 font-medium">Student</th>
                <th scope="col" className="px-3 py-2 font-medium">Lead</th>
                <th scope="col" className="px-3 py-2 font-medium">Requested</th>
                <th scope="col" className="px-3 py-2 font-medium">From</th>
                <th scope="col" className="px-3 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {requests.data.map((request) => (
                <tr key={request.id} className="border-b align-top last:border-b-0 hover:bg-slate-50">
                  <th scope="row" className="px-3 py-2 font-medium whitespace-nowrap">
                    <Link
                      href={`/staff/leads/${request.leadId}`}
                      className="font-mono text-blue-600 underline-offset-4 hover:underline"
                    >
                      {request.admissionNumber}
                    </Link>
                  </th>
                  <td className="px-3 py-2 text-slate-900">{request.studentName}</td>
                  <td className="px-3 py-2">
                    <LeadBadges status={request.status} closure={request.closure} />
                  </td>
                  <td className="px-3 py-2">
                    <p>{request.requestedBy ?? "A staff member"}</p>
                    <time dateTime={request.requestedAt} className="text-xs whitespace-nowrap text-muted-foreground">
                      {when(request.requestedAt)}
                    </time>
                  </td>
                  <td className="px-3 py-2">{SOURCE_LABELS[request.source]}</td>
                  <td className="max-w-sm px-3 py-2 break-words whitespace-pre-line text-slate-900">{request.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
