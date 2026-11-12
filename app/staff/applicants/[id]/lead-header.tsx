import type { ReactNode } from "react"

import { ButtonLink, StatusChip, Tag } from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"
import type { Lead } from "@/lib/services/leads"
import type { LeadImportMark } from "@/lib/services/student-import"

import { initials } from "../../_today/greeting"
import "./lead.css"

// The top of the lead page: who the student is and where the lead stands,
// with History for the Super Admin and the More menu on the right.
export function LeadHeader({
  lead,
  statusSince,
  canViewHistory,
  importMark,
  more,
}: {
  lead: Lead
  // The day the status last changed (YYYY-MM-DD), which every lead reader
  // keeps once the history is the Super Admin's (#237).
  statusSince?: string
  // The full history is the Super Admin's alone (#237).
  canViewHistory: boolean
  // Whether the student import created the lead, and whether its Enrolled is
  // still the import's, with no payment recorded. Left out when unread.
  importMark?: LeadImportMark
  more: ReactNode
}) {
  return (
    <header className="lr-head">
      <div className="lr-head-who">
        <span aria-hidden="true" className="lr-initials">
          {initials(lead.studentName)}
        </span>
        <div className="min-w-0">
          <div className="lr-head-title">
            <h1 className="kit-ph-title">{lead.studentName}</h1>
            <StatusChip status={lead.status} />
            {statusSince && <span className="lr-since">since {formatDate(statusSince)}</span>}
            {lead.closure && <StatusChip status={lead.closure} />}
            {lead.initiallyDeclined && <Tag tone="line">Initially declined</Tag>}
            {lead.returningFamily && <Tag tone="line">Returning family</Tag>}
            {importMark?.batch &&
              (importMark.enrolledByImport ? (
                <Tag tone="line">Enrolled · imported, payments not recorded</Tag>
              ) : (
                <Tag tone="line">Imported</Tag>
              ))}
          </div>
          <p className="lr-meta">
            <span className="lr-number" aria-label="Admission Number">
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
      <div className="lr-head-act">
        {canViewHistory && (
          <ButtonLink href={`/staff/applicants/${lead.id}/history`} variant="ghost" size="small" icon="audit">
            History
          </ButtonLink>
        )}
        {more}
      </div>
    </header>
  )
}
