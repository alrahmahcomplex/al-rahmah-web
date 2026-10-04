import type { ReactNode } from "react"

import type { Lead } from "@/lib/services/leads"
import type { StaffMember } from "@/lib/services/staff-auth"

import { ClosureSection } from "./closure-section"
import { DeclineSection } from "./decline-section"
import { FamilySection } from "./family-section"
import { FollowUpSection } from "./follow-up-section"
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
  // A closed lead is read-only, so the page leaves a panel off it unless the
  // panel is still worth reading there. Such a panel sets this, and offers no
  // work action while `open` is false.
  readOnlyWhenClosed?: true
}

// The panels below the lead summary, top to bottom. A new panel is its own
// file in this folder plus one line here; the page itself stays unchanged.
export const LEAD_PANELS: readonly LeadPanel[] = [
  {
    key: "family",
    readOnlyWhenClosed: true,
    Panel: ({ lead, staff, open }) => (
      <FamilySection
        leadId={lead.id}
        studentName={lead.studentName}
        canEdit={open && staff.permissions.includes("leads.edit")}
      />
    ),
  },
  {
    key: "interview",
    // A closed lead keeps showing its S/N, fee and result, without actions.
    readOnlyWhenClosed: true,
    Panel: ({ lead, staff, open }) => (
      <InterviewSection
        lead={lead}
        canRecord={open && staff.permissions.includes("interviews.record")}
        canMarkFee={open && staff.permissions.includes("interview_payments.record")}
      />
    ),
  },
  {
    key: "school-fee",
    // The fee and what was paid stay readable on a closed lead; the panel
    // has no work actions.
    readOnlyWhenClosed: true,
    Panel: ({ lead, staff }) => <SchoolFeeSection leadId={lead.id} staff={staff} />,
  },
  {
    key: "follow-ups",
    // A closed lead keeps showing its follow-ups, with no actions.
    readOnlyWhenClosed: true,
    Panel: ({ lead, staff, open }) => (
      <FollowUpSection leadId={lead.id} open={open} canRecord={open && staff.permissions.includes("follow_ups.record")} />
    ),
  },
  // Open leads only, for staff who may decline them.
  { key: "decline", Panel: DeclineSection },
  // Declined and Inactive leads too: a mark is the one change a closed lead
  // takes. The panel picks its actions from the lead's mark.
  { key: "closure", readOnlyWhenClosed: true, Panel: ClosureSection },
]
