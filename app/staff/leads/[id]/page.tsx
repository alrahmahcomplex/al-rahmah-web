import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { enrollmentYears, tanzaniaToday } from "@/lib/school-calendar"
import { getLead, isClosed, listContactChildren } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { ClosedLeadBanner } from "./closed-lead-banner"
import { ContactEditor, StudentEditor } from "./lead-editors"
import { LeadSummary } from "./lead-summary"
import { LEAD_PANELS } from "./panels"
import { RecordVisit } from "./record-visit"

export const metadata: Metadata = {
  title: "Lead · Al-Rahmah Complex",
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const { id } = await params
  const supabase = await createClient()
  const lead = await getLead(supabase, id)
  if (!lead.ok && lead.error === "not-found") notFound()
  if (!lead.ok) {
    return (
      <Alert variant="destructive">
        <AlertDescription>This lead could not be loaded. Try again in a moment.</AlertDescription>
      </Alert>
    )
  }

  // A closed lead is read-only: it offers no corrections.
  const open = !isClosed(lead.data)
  const canEditDetails = open && staff.permissions.includes("leads.edit")
  const canCorrectVisit = open && lead.data.visitDate !== null && staff.permissions.includes("visits.record")
  // An open Applied lead is waiting for the family's first visit.
  const canRecordVisit = open && lead.data.status === "Applied" && staff.permissions.includes("visits.record")

  // The children a contact correction would also reach, closed ones included.
  // If they can't be listed, the correction is not offered, so it is never
  // made unwarned.
  const children = canEditDetails ? await listContactChildren(supabase, lead.data.contact.id) : null
  const siblings = children?.ok ? children.data.filter((child) => child.id !== lead.data.id) : []
  const canEditContact = canEditDetails && children?.ok === true

  return (
    <div className="flex flex-col gap-6">
      <LeadSummary
        lead={lead.data}
        nextStep={
          !open ? (
            <ClosedLeadBanner
              lead={lead.data}
              canRequestReopening={staff.permissions.some((p) => p === "leads.create" || p === "leads.edit")}
            />
          ) : (
            // Rendered for every lead the staff member could record a visit
            // on, so the confirmation outlasts the refresh that removes the
            // offer once the lead is Visited.
            staff.permissions.includes("visits.record") && (
              <RecordVisit key={lead.data.id} leadId={lead.data.id} canRecord={canRecordVisit} />
            )
          )
        }
        student={(fields) => (
          <StudentEditor
            lead={lead.data}
            years={enrollmentYears()}
            today={tanzaniaToday()}
            canEditDetails={canEditDetails}
            canCorrectVisit={canCorrectVisit}
          >
            {fields}
          </StudentEditor>
        )}
        parent={(fields) => (
          <ContactEditor lead={lead.data} siblings={siblings} canEdit={canEditContact}>
            {fields}
          </ContactEditor>
        )}
      />
      {LEAD_PANELS.filter((panel) => open || panel.readOnlyWhenClosed).map(({ key, Panel }) => (
        <Panel key={key} lead={lead.data} staff={staff} open={open} />
      ))}
      <div className="flex flex-wrap gap-2">
        <Link href={`/staff/leads/${lead.data.id}/history`} className={buttonVariants({ variant: "outline" })}>History</Link>
        <Link href="/staff/check-in" className={buttonVariants({ variant: "outline" })}>Back to Check-in</Link>
      </div>
    </div>
  )
}
