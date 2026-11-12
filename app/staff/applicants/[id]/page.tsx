import type { Metadata } from "next"
import { forbidden, notFound } from "next/navigation"

import { ButtonLink, Note, pageTitle } from "@/components/kit"
import { declinedReasonsFor, marksAllowed } from "@/lib/services/lead-closure"
import { getLead, isClosed } from "@/lib/services/leads"
import { getLeadImportMark } from "@/lib/services/student-import"
import { getLeadStatusSince } from "@/lib/services/system-audit"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { ClosedLeadBanner } from "./closed-lead-banner"
import { LEAD_CARD } from "./lead-card"
import { LeadHeader } from "./lead-header"
import { LeadTabs } from "./lead-tabs"
import { LeadMoreMenu } from "./lead-more-menu"
import { NextStepCard } from "./next-step-card"
import { LEAD_PANELS } from "./panels"
import { canRaiseReopening } from "./reopening-outcome"
import { nobodyHasAsked } from "./reopening-section"
import { leadTab } from "./tabs"

export const metadata: Metadata = {
  title: pageTitle("Application"),
}

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const [{ id }, { tab: tabParam }] = await Promise.all([params, searchParams])
  const tab = leadTab(tabParam)
  const supabase = await createClient()
  const [lead, statusSince, importMark] = await Promise.all([
    getLead(supabase, id),
    getLeadStatusSince(supabase, id),
    getLeadImportMark(supabase, id),
  ])
  if (!lead.ok && lead.error === "not-found") notFound()
  if (!lead.ok) {
    return (
      <Note tone="bad">This application could not be loaded. Try again in a moment.</Note>
    )
  }

  const open = !isClosed(lead.data)
  const canRequestReopening = !open && canRaiseReopening(staff.permissions)
  // A mark is the one change a closed lead takes, so Mark inactive and Archive
  // follow the lead's mark rather than `open`.
  const marks = staff.permissions.includes("leads.close") ? marksAllowed(lead.data.closure) : []

  return (
    <div className="lr-page">
      <LeadHeader
        lead={lead.data}
        statusSince={statusSince.ok ? statusSince.data : undefined}
        canViewHistory={staff.permissions.includes("audit.view")}
        importMark={importMark.ok ? importMark.data : undefined}
        more={
          <LeadMoreMenu
            lead={{
              id: lead.data.id,
              studentName: lead.data.studentName,
              admissionNumber: lead.data.admissionNumber,
              status: lead.data.status,
            }}
            declineReasons={open && staff.permissions.includes("leads.decline") ? declinedReasonsFor(staff.permissions) : null}
            marks={marks}
            canRequestReopening={canRequestReopening && (await nobodyHasAsked(lead.data.id))}
          />
        }
      />

      {open ? (
        <NextStepCard lead={lead.data} staff={staff} tab={tab} />
      ) : (
        <ClosedLeadBanner lead={lead.data} canRequestReopening={canRequestReopening} />
      )}

      <LeadTabs leadId={lead.data.id} tab={tab} />

      <div className="lr-grid">
        {LEAD_PANELS.filter((panel) => panel.tab === tab && (open || panel.readOnlyWhenClosed)).map(
          ({ key, wide, Panel }) => (
            <div key={key} className={wide ? `${LEAD_CARD} lr-wide` : LEAD_CARD}>
              <Panel lead={lead.data} staff={staff} open={open} />
            </div>
          ),
        )}
      </div>

      <div>
        <ButtonLink href="/staff/check-in" variant="ghost">
          Back to Check-in
        </ButtonLink>
      </div>
    </div>
  )
}
