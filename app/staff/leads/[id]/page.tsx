import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { declinedReasonsFor, marksAllowed } from "@/lib/services/lead-closure"
import { getLead, isClosed } from "@/lib/services/leads"
import { getLeadStatusSince } from "@/lib/services/system-audit"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { ClosedLeadBanner } from "./closed-lead-banner"
import { LEAD_CARD } from "./lead-card"
import { LeadHeader } from "./lead-header"
import { LeadMoreMenu } from "./lead-more-menu"
import { NextStepCard } from "./next-step-card"
import { LEAD_PANELS } from "./panels"
import { RecordVisit } from "./record-visit"
import { canRaiseReopening } from "./reopening-outcome"
import { nobodyHasAsked } from "./reopening-section"
import { LEAD_TABS, leadTab, leadTabHref } from "./tabs"

export const metadata: Metadata = {
  title: "Lead · Al-Rahmah Complex",
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
  const [lead, statusSince] = await Promise.all([getLead(supabase, id), getLeadStatusSince(supabase, id)])
  if (!lead.ok && lead.error === "not-found") notFound()
  if (!lead.ok) {
    return (
      <Alert variant="destructive">
        <AlertDescription>This lead could not be loaded. Try again in a moment.</AlertDescription>
      </Alert>
    )
  }

  const open = !isClosed(lead.data)
  // An open Applied lead is waiting for the family's first visit.
  const canRecordVisit = open && lead.data.status === "Applied" && staff.permissions.includes("visits.record")
  const canRequestReopening = !open && canRaiseReopening(staff.permissions)
  // A mark is the one change a closed lead takes, so Mark inactive and Archive
  // follow the lead's mark rather than `open`.
  const marks = staff.permissions.includes("leads.close") ? marksAllowed(lead.data.closure) : []

  return (
    <div className="flex flex-col gap-5">
      <LeadHeader
        lead={lead.data}
        statusSince={statusSince.ok ? statusSince.data : undefined}
        canViewHistory={staff.permissions.includes("audit.view")}
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
        <NextStepCard
          lead={lead.data}
          staff={staff}
          tab={tab}
          recordVisit={
            // Rendered for every lead the staff member could record a visit
            // on, so the confirmation outlasts the refresh that removes the
            // offer once the lead is Visited.
            staff.permissions.includes("visits.record") && (
              <RecordVisit key={lead.data.id} leadId={lead.data.id} canRecord={canRecordVisit} />
            )
          }
        />
      ) : (
        <ClosedLeadBanner lead={lead.data} canRequestReopening={canRequestReopening} />
      )}

      <nav aria-label="Lead sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b">
          {LEAD_TABS.map(({ key, label }) => (
            <li key={key}>
              <Link
                href={leadTabHref(lead.data.id, key)}
                scroll={false}
                aria-current={key === tab ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                  key === tab
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-muted-foreground hover:border-slate-300 hover:text-slate-900",
                )}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {LEAD_PANELS.filter((panel) => panel.tab === tab && (open || panel.readOnlyWhenClosed)).map(
          ({ key, wide, Panel }) => (
            <div key={key} className={cn(LEAD_CARD, wide && "lg:col-span-2")}>
              <Panel lead={lead.data} staff={staff} open={open} />
            </div>
          ),
        )}
      </div>

      <div>
        <Link href="/staff/check-in" className={buttonVariants({ variant: "outline" })}>
          Back to Check-in
        </Link>
      </div>
    </div>
  )
}
