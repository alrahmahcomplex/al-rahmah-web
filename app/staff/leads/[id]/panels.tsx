import type { ReactNode } from "react"

import type { Lead } from "@/lib/services/leads"
import type { StaffMember } from "@/lib/services/staff-auth"

import { ClosureSection } from "./closure-section"
import { DeclineSection } from "./decline-section"
import { FamilySection } from "./family-section"
import { FollowUpSection } from "./follow-up-section"
import { InterviewSection } from "./interview-section"
import { ReApplicationSection } from "./re-application-section"
import { ReopenedNote } from "./reopened-note"
import { ReopeningSection } from "./reopening-section"
import { ReferralSection } from "./referral-section"
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
  // First, under a closed lead's banner: the Pending request and earlier
  // requests. A request exists only for a closed lead, so its actions,
  // Withdraw for the requester and Approve and Reject for approvers, stay
  // while the lead is closed (an exception recorded in
  // docs/agents/parallel-work.md).
  { key: "reopenings", readOnlyWhenClosed: true, Panel: ReopeningSection },
  // The Reopened after decline note: when and by whom. No actions.
  { key: "reopened", readOnlyWhenClosed: true, Panel: ReopenedNote },
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
  // Shown on a closed lead too: a re-application may arrive for one, and its
  // review is the re-application's, not the lead's.
  { key: "re-applications", readOnlyWhenClosed: true, Panel: ReApplicationSection },
  {
    key: "referral",
    // The code and the fee stay readable on a closed lead, without Edit or Clear.
    readOnlyWhenClosed: true,
    Panel: ({ lead, staff, open }) => (
      <ReferralSection leadId={lead.id} canEdit={open && staff.permissions.includes("leads.edit")} />
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
    // The fee and what was paid stay readable on a closed lead, without
    // Record payment. Adjust stays: it corrects history rather than
    // continuing work (an exception recorded in docs/agents/parallel-work.md).
    readOnlyWhenClosed: true,
    Panel: ({ lead, staff, open }) => (
      <SchoolFeeSection
        leadId={lead.id}
        staff={staff}
        canRecord={open && staff.permissions.includes("payments.record")}
        canAdjust={staff.permissions.includes("payments.record")}
      />
    ),
  },
  {
    key: "follow-ups",
    // A closed lead keeps showing its follow-ups, with no actions.
    readOnlyWhenClosed: true,
    Panel: ({ lead, staff, open }) => (
      <FollowUpSection
        leadId={lead.id}
        open={open}
        canRecord={open && staff.permissions.includes("follow_ups.record")}
        enrolled={lead.status === "Enrolled"}
        staff={{ id: staff.id, name: staff.name }}
      />
    ),
  },
  // Open leads only, for staff who may decline them.
  { key: "decline", Panel: DeclineSection },
  // Declined and Inactive leads too: a mark is the one change a closed lead
  // takes. The panel picks its actions from the lead's mark.
  { key: "closure", readOnlyWhenClosed: true, Panel: ClosureSection },
]
