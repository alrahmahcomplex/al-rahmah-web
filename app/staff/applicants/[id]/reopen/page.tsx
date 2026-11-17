import type { Metadata } from "next"

import { ButtonLink, Card, Note, pageTitle } from "@/components/kit"
import { getLead, isClosed, type Lead } from "@/lib/services/leads"
import { getLeadReopenings, type ReopeningSource } from "@/lib/services/reopening-requests"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import StaffForbidden from "../../../forbidden"
import StaffNotFound from "../../../not-found"
import { requireStaff } from "../../../session"
import "../lead.css"
import { LeadSummary } from "./lead-summary"
import { alreadyRequested, canRaiseReopening, reopeningSourceOf } from "../reopening-outcome"
import { RequestReopeningForm } from "./request-form"

export const metadata: Metadata = {
  title: pageTitle("Request reopening"),
}

// The Reopening request form for a closed lead. Reached from Request
// reopening on the lead screen (`?source=lead`), and from the front desk's
// Family hand-off and the duplicate refusal (`?source=duplicate_match`). A
// lead with a Pending request shows who asked and when instead of the form.
export default async function ReopenLeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) return <StaffForbidden />

  const { id } = await params
  const source = reopeningSourceOf((await searchParams).source)
  const lead = await getLead(await createClient(), id)
  if (!lead.ok && lead.error === "not-found") return <StaffNotFound />
  if (!lead.ok) {
    return (
      <Note tone="bad" role="alert">
        This application could not be loaded. Try again in a moment.
      </Note>
    )
  }

  return (
    <div className="lr-page">
      {source === "duplicate_match" && isClosed(lead.data) && (
        <Note role="alert">
          This student is already on file, so no new record was made. To bring the family back, ask for this application
          to be reopened.
        </Note>
      )}
      <LeadSummary lead={lead.data} nextStep={<ReopenStep lead={lead.data} staff={staff} source={source} />} />
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/staff/applicants/${lead.data.id}`} variant="ghost">
          {source === "lead" ? "Back to the application" : "Open the application"}
        </ButtonLink>
        {source !== "lead" && (
          <ButtonLink href="/staff" variant="ghost">
            Back to Home
          </ButtonLink>
        )}
      </div>
    </div>
  )
}

async function ReopenStep({ lead, staff, source }: { lead: Lead; staff: StaffMember; source: ReopeningSource }) {
  if (!isClosed(lead)) {
    return <Note role="status">This application is open, so there is nothing to reopen.</Note>
  }
  if (!canRaiseReopening(staff.permissions)) {
    return <Note role="status">Your role can&apos;t request reopening. You can read the record below.</Note>
  }

  const reopenings = await getLeadReopenings(await createClient(), lead.id)
  if (!reopenings.ok) {
    return (
      <Note tone="bad" role="alert">
        The application&apos;s reopening requests could not be loaded. Try again in a moment.
      </Note>
    )
  }

  const pending = reopenings.data.pending
  if (pending) {
    return (
      <Note role="status">
        {alreadyRequested(pending.requestedById === staff.id ? "you" : pending.requestedBy, pending.requestedAt)} A
        Manager will approve or reject it.
      </Note>
    )
  }

  return (
    <Card
      title="Request reopening"
      caption="A Manager approves reopening. Until then the application stays read-only."
      className="lr-card"
    >
      <RequestReopeningForm leadId={lead.id} source={source} />
    </Card>
  )
}
