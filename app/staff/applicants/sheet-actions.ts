"use server"

import { nextStepText } from "@/lib/lead-next-step"
import { formatDate } from "@/lib/school-calendar"
import { getLead, isClosed } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../fees/format"
import { readFee } from "./[id]/lead-reads"
import { parentRows, studentRows } from "./[id]/lead-rows"
import { readNextStep } from "./[id]/next-step-read"
import { leadTabHref } from "./[id]/tabs"
import { requireStaff } from "../session"
import type { ApplicantSheetAnswer } from "./sheet-view"

/**
 * What the Applicants side sheet shows for one applicant, read when a row
 * opens it: the record's own Student and Custodian rows, the School fee
 * summary for staff who may view payments, and the next step on an open
 * lead. Only what the record has today (#324): the Sibling group, the
 * father's name and the previous school arrive with #310.
 */
export async function loadApplicantSheet(leadId: string): Promise<ApplicantSheetAnswer> {
  if (typeof leadId !== "string") return { status: "not-found" }
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) return { status: "failed" }

  const lead = await getLead(await createClient(), leadId)
  if (!lead.ok) return { status: lead.error === "not-found" ? "not-found" : "failed" }

  const open = !isClosed(lead.data)
  const canSeeFee = staff.permissions.includes("payments.view")
  const [fee, step] = await Promise.all([canSeeFee ? readFee(leadId) : null, open ? readNextStep(lead.data, canSeeFee) : null])

  const text = step && step.kind !== "closed" ? nextStepText(step, formatDate) : null
  return {
    status: "ready",
    view: {
      id: lead.data.id,
      studentName: lead.data.studentName,
      status: lead.data.status,
      closure: lead.data.closure,
      student: [
        ["Admission Number", lead.data.admissionNumber],
        // The status is the chip under the name.
        ...studentRows(lead.data).filter(([key]) => key !== "Status"),
      ],
      custodian: parentRows(lead.data),
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
    },
  }
}
