import type { LeadPreviousSchool } from "@/lib/services/lead-details"
import type { LeadClass, LeadClosure, LeadStatus } from "@/lib/services/leads"
import type { SeatPriority } from "@/lib/services/school-fee-payments"

import type { SiblingGroupView } from "./[id]/sibling-read"

// What the Applicants side sheet is given for one applicant (sheet-actions).
// Plain data, so it crosses from the server action to the sheet.

export type ApplicantSheetFee =
  | { state: "failed" }
  | { state: "no-schedule"; year: number }
  | {
      state: "fee"
      // Whole TZS, formatted.
      annualFee: string
      paid: string
      balance: string
      priority: SeatPriority | null
      priorityReachedOn: string | null
      // The record's School fee tab, for staff who may record a payment on an open lead.
      recordPaymentHref: string | null
    }

export type ApplicantSheetView = {
  id: string
  studentName: string
  status: LeadStatus
  closure: LeadClosure | null
  className: LeadClass
  // False on a closed lead, which is read-only.
  open: boolean
  // leads.edit on an open lead: the father's name and previous school take Edit.
  canEdit: boolean
  student: [string, string][]
  // The father's full name and previous school (#310); null when they could not be read.
  fatherAndSchool: { father: string | null; previousSchool: LeadPreviousSchool } | null
  // The Sibling group (#310); null when it could not be read.
  sibling: SiblingGroupView | null
  custodian: [string, string][]
  // Null for staff who may not view payments.
  fee: ApplicantSheetFee | null
  // Null on a closed lead.
  nextStep: { state: "ready"; title: string } | { state: "failed" } | null
}

export type ApplicantSheetAnswer =
  | { status: "ready"; view: ApplicantSheetView }
  | { status: "not-found" }
  | { status: "failed" }
