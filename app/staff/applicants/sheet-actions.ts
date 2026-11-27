"use server"

import { nextStepText } from "@/lib/lead-next-step"
import { schoolLevelOf } from "@/lib/result-messages"
import { formatDate } from "@/lib/school-calendar"
import { getLeadFatherAndSchool } from "@/lib/services/lead-details"
import { getLead, isClosed } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../fees/format"
import { feeWhy, setByHandLine } from "./[id]/fee-edit-outcome"
import { readFee } from "./[id]/lead-reads"
import { parentRows, studentRows } from "./[id]/lead-rows"
import { readNextStep } from "./[id]/next-step-read"
import { readSiblingGroup } from "./[id]/sibling-read"
import { leadTabHref } from "./[id]/tabs"
import { checkInRouteFor } from "../check-in/route-to"
import { requireStaff } from "../session"
import type { ApplicantSheetAnswer } from "./sheet-view"

/**
 * What the Applicants side sheet shows for one applicant, read when a row
 * opens it: the record's own Student and Custodian rows, the School fee
 * summary for staff who may view payments, and the next step on an open
 * lead, the father's name, the previous school and the Sibling group (#310).
 * An Admission form child still waiting for its visit offers check-in (#309).
 */
export async function loadApplicantSheet(leadId: string): Promise<ApplicantSheetAnswer> {
  if (typeof leadId !== "string") return { status: "not-found" }
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) return { status: "failed" }

  const supabase = await createClient()
  const lead = await getLead(supabase, leadId)
  if (!lead.ok) return { status: lead.error === "not-found" ? "not-found" : "failed" }

  const open = !isClosed(lead.data)
  const canSeeFee = staff.permissions.includes("payments.view")
  // One read of the fee, for the School fee section and the next step.
  const feeRead = canSeeFee ? readFee(leadId) : null
  const [fee, step, details, sibling, checkIn] = await Promise.all([
    feeRead,
    open ? readNextStep(lead.data, feeRead) : null,
    getLeadFatherAndSchool(supabase, leadId),
    readSiblingGroup(supabase, leadId, staff.permissions),
    open && lead.data.status === "Applied" ? checkInRouteFor(supabase, leadId, staff.permissions) : null,
  ])

  const text =
    step && step.kind !== "closed"
      ? nextStepText(step, formatDate, {
          canMarkAgreement: staff.permissions.includes("agreements.mark"),
          schoolLevel: schoolLevelOf(lead.data.className),
        })
      : null
  const byHand = sibling && setByHandLine(sibling.fee)
  return {
    status: "ready",
    view: {
      id: lead.data.id,
      studentName: lead.data.studentName,
      status: lead.data.status,
      closure: lead.data.closure,
      className: lead.data.className,
      open,
      canEdit: open && staff.permissions.includes("leads.edit"),
      fatherAndSchool: details.ok ? { father: details.data.fatherFullName, previousSchool: details.data.previousSchool } : null,
      sibling,
      student: [
        ["Admission Number", lead.data.admissionNumber],
        // The status is the chip under the name.
        ...studentRows(lead.data).filter(([key]) => key !== "Status"),
      ],
      custodian: [
        ...parentRows(lead.data),
        ...(details.ok && details.data.broughtBy ? ([["Brought by", details.data.broughtBy]] as [string, string][]) : []),
      ],
      fee:
        fee === null
          ? null
          : !fee.ok
            ? { state: "failed" }
            : fee.data.kind === "no-schedule"
              ? { state: "no-schedule", year: fee.data.year }
              : {
                  state: "fee",
                  annualFee: formatShillings(fee.data.schoolFee),
                  why: [feeWhy(fee.data.discount?.kind ?? null), byHand].filter(Boolean).join(" · "),
                  paid: formatShillings(fee.data.totalPaid),
                  balance: formatShillings(fee.data.balance),
                  priority: fee.data.priority,
                  priorityReachedOn: fee.data.priorityReachedOn ? formatDate(fee.data.priorityReachedOn) : null,
                  recordPaymentHref:
                    open && staff.permissions.includes("payments.record")
                      ? leadTabHref(lead.data.id, "school-fee", "lead-school-fee")
                      : null,
                },
      // Null on a closed lead, where the record shows its closed banner instead.
      nextStep: open ? (text ? { state: "ready", title: text.title } : { state: "failed" }) : null,
      checkInHref: checkIn,
    },
  }
}
