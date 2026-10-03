import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { getLead, isClosed, type Lead } from "@/lib/services/leads"
import { getLeadReopenings, type ReopeningSource } from "@/lib/services/reopening-requests"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../../session"
import { LeadSummary } from "../lead-summary"
import { alreadyRequested, canRaiseReopening, reopeningSourceOf } from "../reopening-outcome"
import { RequestReopeningForm } from "./request-form"

export const metadata: Metadata = {
  title: "Request reopening · Al-Rahmah Complex",
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
  if (!staff.permissions.includes("leads.view")) forbidden()

  const { id } = await params
  const source = reopeningSourceOf((await searchParams).source)
  const lead = await getLead(await createClient(), id)
  if (!lead.ok && lead.error === "not-found") notFound()
  if (!lead.ok) {
    return (
      <Alert variant="destructive">
        <AlertDescription>This lead could not be loaded. Try again in a moment.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {source === "duplicate_match" && (
        <Alert>
          <AlertDescription>
            This student is already on file, so no new record was made. To bring the family back, ask for this lead
            to be reopened.
          </AlertDescription>
        </Alert>
      )}
      <LeadSummary lead={lead.data} nextStep={<ReopenStep lead={lead.data} staff={staff} source={source} />} />
      <div className="flex flex-wrap gap-2">
        <Link href={`/staff/leads/${lead.data.id}`} className={buttonVariants({ variant: "outline" })}>
          {source === "lead" ? "Back to the lead" : "Open the lead"}
        </Link>
        {source !== "lead" && (
          <Link href="/staff/check-in" className={buttonVariants({ variant: "outline" })}>
            Back to Check-in
          </Link>
        )}
      </div>
    </div>
  )
}

async function ReopenStep({ lead, staff, source }: { lead: Lead; staff: StaffMember; source: ReopeningSource }) {
  if (!isClosed(lead)) {
    return <Note>This lead is open, so there is nothing to reopen.</Note>
  }
  if (!canRaiseReopening(staff.permissions)) {
    return <Note>Your role can&apos;t request reopening. You can read the record below.</Note>
  }

  const reopenings = await getLeadReopenings(await createClient(), lead.id)
  if (!reopenings.ok) {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertDescription>The lead&apos;s reopening requests could not be loaded. Try again in a moment.</AlertDescription>
      </Alert>
    )
  }

  const pending = reopenings.data.pending
  if (pending) {
    return (
      <Note>
        {alreadyRequested(pending.requestedById === staff.id ? "you" : pending.requestedBy, pending.requestedAt)} A
        Manager will approve or reject it.
      </Note>
    )
  }

  return (
    <section aria-labelledby="reopen-request" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="reopen-request" className="text-sm font-semibold text-slate-900">
          Request reopening
        </h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          A Manager approves reopening. Until then the lead stays read-only.
        </p>
      </div>
      <RequestReopeningForm leadId={lead.id} source={source} />
    </section>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="max-w-xl rounded-lg border bg-card p-4 text-sm text-slate-900">
      {children}
    </p>
  )
}
