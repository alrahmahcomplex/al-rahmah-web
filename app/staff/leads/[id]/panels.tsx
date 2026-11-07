import type { ReactNode } from "react"

import { declinedReasonsFor } from "@/lib/services/lead-closure"
import type { Lead } from "@/lib/services/leads"
import type { StaffMember } from "@/lib/services/staff-auth"

import { DiscountSection } from "./discount-section"
import { FamilySection } from "./family-section"
import { FollowUpSection } from "./follow-up-section"
import { GroupInvitationSection } from "./group-invitation-section"
import { InterviewSection } from "./interview-section"
import { FeeSummaryPanel, ParentPanel, RecentActivityPanel, StudentPanel } from "./overview-panels"
import { ReApplicationSection } from "./re-application-section"
import { ReopenedNote } from "./reopened-note"
import { ReopeningSection } from "./reopening-section"
import { ReferralSection } from "./referral-section"
import { SchoolFeeSection } from "./school-fee-section"
import type { LeadTab } from "./tabs"

// What every panel on the lead screen is given.
export type LeadPanelProps = {
  lead: Lead
  staff: StaffMember
  // False once the lead is Declined or carries a closure mark: it is read-only.
  open: boolean
}

export type LeadPanel = {
  key: string
  // The tab the panel shows on.
  tab: LeadTab
  // Takes a whole row of the two-column grid.
  wide?: true
  Panel: (props: LeadPanelProps) => ReactNode | Promise<ReactNode>
  // A closed lead is read-only, so the page leaves a panel off it unless the
  // panel is still worth reading there. Such a panel sets this, and offers no
  // work action while `open` is false.
  readOnlyWhenClosed?: true
}

// The panels under the lead's header and Next step, tab by tab, in reading
// order: two to a row on wide screens, one below. A new panel is its own file
// in this folder plus one line here; the page itself stays unchanged. Decline,
// Mark inactive, Archive and Request reopening live in the header's More menu.
export const LEAD_PANELS: readonly LeadPanel[] = [
  // First, under a closed lead's banner: the Pending request and earlier
  // requests. A request exists only for a closed lead, so its actions,
  // Withdraw for the requester and Approve and Reject for approvers, stay
  // while the lead is closed (an exception recorded in
  // docs/agents/parallel-work.md).
  { key: "reopenings", tab: "overview", wide: true, readOnlyWhenClosed: true, Panel: ReopeningSection },
  // The Reopened after decline note: when and by whom. No actions.
  { key: "reopened", tab: "overview", wide: true, readOnlyWhenClosed: true, Panel: ReopenedNote },
  // Shown on a closed lead too: a re-application may arrive for one, and its
  // review is the re-application's, not the lead's.
  { key: "re-applications", tab: "overview", wide: true, readOnlyWhenClosed: true, Panel: ReApplicationSection },
  // Read-only on a closed lead: it offers no corrections.
  { key: "student", tab: "overview", readOnlyWhenClosed: true, Panel: StudentPanel },
  { key: "parent", tab: "overview", readOnlyWhenClosed: true, Panel: ParentPanel },
  {
    key: "family",
    tab: "overview",
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
    key: "referral",
    tab: "overview",
    // The code and the fee stay readable on a closed lead, without Edit or Clear.
    readOnlyWhenClosed: true,
    Panel: ({ lead, staff, open }) => (
      <ReferralSection leadId={lead.id} canEdit={open && staff.permissions.includes("leads.edit")} />
    ),
  },
  { key: "fee-summary", tab: "overview", readOnlyWhenClosed: true, Panel: FeeSummaryPanel },
  { key: "recent-activity", tab: "overview", readOnlyWhenClosed: true, Panel: RecentActivityPanel },
  {
    key: "interview",
    tab: "interview",
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
  // A closed lead keeps showing its latest invitation, without the button.
  { key: "group-invitation", tab: "interview", readOnlyWhenClosed: true, Panel: GroupInvitationSection },
  {
    key: "school-fee",
    tab: "school-fee",
    wide: true,
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
        canEditPreFormOne={open && staff.permissions.includes("leads.edit")}
        formOne={lead.className === "FORM 1"}
      />
    ),
  },
  // Staff child and Qualified orphan requests; readable on a closed lead,
  // without actions.
  { key: "discounts", tab: "discounts", wide: true, readOnlyWhenClosed: true, Panel: DiscountSection },
  {
    key: "follow-ups",
    tab: "follow-ups",
    wide: true,
    // A closed lead keeps showing its follow-ups, with no actions. The panel
    // also asks the database whether the lead is closed (lead_is_closed).
    readOnlyWhenClosed: true,
    Panel: ({ lead, staff, open }) => (
      <FollowUpSection
        leadId={lead.id}
        canRecord={open && staff.permissions.includes("follow_ups.record")}
        declineReasons={staff.permissions.includes("leads.decline") ? declinedReasonsFor(staff.permissions) : null}
        enrolled={lead.status === "Enrolled"}
        staff={{ id: staff.id, name: staff.name }}
      />
    ),
  },
]
