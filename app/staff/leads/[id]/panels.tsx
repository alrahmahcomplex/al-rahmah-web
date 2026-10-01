import type { ReactNode } from "react"

import type { Lead } from "@/lib/services/leads"
import type { StaffMember } from "@/lib/services/staff-auth"

import { FamilySection } from "./family-section"
import { InterviewSection } from "./interview-section"
import { SchoolFeeSection } from "./school-fee-section"

// What every panel on the lead screen is given.
export type LeadPanelProps = {
  lead: Lead
  staff: StaffMember
  // False once the lead is Declined or carries a closure mark: it is read-only.
  open: boolean
}

export type LeadPanel = {
  key: string
  Panel: (props: LeadPanelProps) => ReactNode | Promise<ReactNode>
}

// The panels below the lead summary, top to bottom. A new panel is its own
// file in this folder plus one line here; the page itself stays unchanged.
export const LEAD_PANELS: readonly LeadPanel[] = [
  {
    key: "family",
    Panel: ({ lead, staff, open }) => (
      <FamilySection
        leadId={lead.id}
        studentName={lead.studentName}
        canEdit={open && staff.permissions.includes("leads.edit")}
      />
    ),
  },
  { key: "interview", Panel: ({ lead, staff, open }) => <InterviewSection lead={lead} canRecord={open && staff.permissions.includes("interviews.record")} /> },
  { key: "school-fee", Panel: ({ lead, staff }) => <SchoolFeeSection leadId={lead.id} staff={staff} /> },
]
