import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { Card, EmptyState, Note, PageHeader, pageTitle } from "@/components/kit"
import { listPendingReopeningRequests } from "@/lib/services/lead-closure"
import { createClient } from "@/utils/supabase/server"

import { canDecideReopening } from "../applicants/[id]/reopening-decision-outcome"
import { SOURCE_LABELS } from "../applicants/[id]/reopening-outcome"
import { when } from "../re-applications/format"
import { requireStaff } from "../session"
import { RequestsTable, type RequestRow } from "./requests-table"

export const metadata: Metadata = {
  title: pageTitle("Reopening requests"),
}

// Every Pending Reopening request, oldest first, for approvers (#100). Each
// request links to its lead, where the approver reads the history and
// decides, so the page also needs leads.view: without it the lead screen is
// forbidden and nothing here could be decided. Drawn in the new shell (#322).
export default async function ReopeningRequestsPage() {
  const staff = await requireStaff()
  if (!canDecideReopening(staff.permissions) || !staff.permissions.includes("leads.view")) forbidden()

  const requests = await listPendingReopeningRequests(await createClient())

  const rows: RequestRow[] = requests.ok
    ? requests.data.map((request) => ({
        id: request.id,
        leadId: request.leadId,
        admissionNumber: request.admissionNumber,
        studentName: request.studentName,
        status: request.status,
        closure: request.closure,
        requestedBy: request.requestedBy ?? "A staff member",
        requestedAt: request.requestedAt,
        requestedOn: when(request.requestedAt),
        source: `From the ${SOURCE_LABELS[request.source].toLowerCase()}`,
        reason: request.reason,
      }))
    : []

  return (
    <>
      <PageHeader
        title="Reopening requests"
        subtitle="Closed applications waiting for a decision, oldest first. Open an application to approve or reject its request."
      />
      {!requests.ok ? (
        <Note tone="bad" role="alert">
          Reopening requests could not be loaded. Try again in a moment.
        </Note>
      ) : (
        <Card>{rows.length === 0 ? <EmptyState title="No reopening requests are waiting." /> : <RequestsTable rows={rows} />}</Card>
      )}
    </>
  )
}
