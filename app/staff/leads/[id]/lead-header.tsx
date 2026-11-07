import { HistoryIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { StatusChip } from "@/components/status-chip"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { formatDate } from "@/lib/school-calendar"
import type { Lead } from "@/lib/services/leads"

import { initials } from "../../_today/greeting"

// The top of the lead page: who the student is and where the lead stands,
// with History for the Super Admin and the More menu on the right.
export function LeadHeader({
  lead,
  statusSince,
  canViewHistory,
  more,
}: {
  lead: Lead
  // The day the status last changed (YYYY-MM-DD), which every lead reader
  // keeps once the history is the Super Admin's (#237).
  statusSince?: string
  // The full history is the Super Admin's alone (#237).
  canViewHistory: boolean
  more: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-base font-semibold text-blue-700"
        >
          {initials(lead.studentName)}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="staff-heading break-words">{lead.studentName}</h1>
            <StatusChip status={lead.status} />
            {statusSince && <span className="text-sm text-muted-foreground">since {formatDate(statusSince)}</span>}
            {lead.closure && <StatusChip status={lead.closure} />}
            {lead.initiallyDeclined && <Badge variant="outline">Initially declined</Badge>}
            {lead.returningFamily && <Badge variant="outline">Returning family</Badge>}
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span className="font-mono font-semibold text-slate-900" aria-label="Admission Number">
              {lead.admissionNumber}
            </span>
            <span aria-hidden="true">·</span>
            <span>{lead.className}</span>
            <span aria-hidden="true">·</span>
            <span>{lead.enrollmentYear}</span>
            <span aria-hidden="true">·</span>
            <span>{lead.dayOrBoarding}</span>
            <span aria-hidden="true">·</span>
            <span>{lead.visitDate ? `Visited ${formatDate(lead.visitDate)}` : "Not visited yet"}</span>
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        {canViewHistory && (
          <Link href={`/staff/leads/${lead.id}/history`} className={buttonVariants({ variant: "outline" })}>
            <HistoryIcon aria-hidden="true" />
            History
          </Link>
        )}
        {more}
      </div>
    </header>
  )
}
