import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { enrollmentYears, tanzaniaToday } from "@/lib/school-calendar"
import { getLead, isClosed, listContactChildren } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { ContactEditor, StudentEditor } from "./lead-editors"
import { LeadSummary } from "./lead-summary"
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

  // The children a contact correction would also reach. If they can't be
  // listed, the correction is not offered, so it is never made unwarned.
  const children = canEditDetails ? await listContactChildren(supabase, lead.data.contact.id) : null
  const siblings = children?.ok ? children.data.filter((child) => child.id !== lead.data.id) : []
  // A contact a closed brother or sister is on is read-only, like their lead.
  const closedSibling = siblings.find(isClosed) ?? null
  const canEditContact = canEditDetails && children?.ok === true && !closedSibling

  return (
    <div className="flex flex-col gap-6">
      <LeadSummary
        lead={lead.data}
        nextStep={
          // Rendered for every lead the staff member could record a visit
          // on, so the confirmation outlasts the refresh that removes the
          // offer once the lead is Visited.
          staff.permissions.includes("visits.record") && (
            <RecordVisit key={lead.data.id} leadId={lead.data.id} today={tanzaniaToday()} canRecord={canRecordVisit} />
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
          <ContactEditor lead={lead.data} siblings={siblings} canEdit={canEditContact} closedSibling={closedSibling}>
            {fields}
          </ContactEditor>
        )}
      />
      <div>
        <Link href="/staff/check-in" className={buttonVariants({ variant: "outline" })}>Back to Check-in</Link>
      </div>
    </div>
  )
}
