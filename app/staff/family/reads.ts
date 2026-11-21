import "server-only"

import type { Permission } from "@/lib/permissions"
import { getInterviewRegistration, getLeadInterviews } from "@/lib/services/interviews"
import { getLeadFatherAndSchool, type LeadPreviousSchool } from "@/lib/services/lead-details"
import { getLeadFee } from "@/lib/services/lead-fees"
import { getLead, isClosed, listContactChildren, type Lead } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { readSiblingGroup, type SiblingPerson } from "../applicants/[id]/sibling-read"
import { byCustodian } from "./model"

// Everything the Family page shows, read lead by lead with the staff
// member's own session, so row-level security decides what they see. A lead
// they may not read is "not-found", and so is the whole page: it never shows
// part of a family.

export type FamilyFee =
  | { kind: "fee"; pays: number; why: string }
  | { kind: "no-schedule"; year: number }
  | { kind: "unavailable" }

export type FamilyStudent = {
  lead: Lead
  // False once the lead is Declined or carries a closure mark: read-only.
  open: boolean
  father: string | null
  previousSchool: LeadPreviousSchool
  // "Name (Relationship)", or null.
  broughtBy: string | null
  // On the interview list already; or may be registered now (its first interview).
  interview: "registered" | "can-register" | "none"
  // Whom a Sibling request after a father's name change compares with.
  compareWith: SiblingPerson | null
  // For staff who may view payments; null otherwise.
  fee: FamilyFee | null
}

export type FamilyCustodian = {
  contactId: string
  // The students on this page who sit on the custodian, in the page's order.
  members: string[]
  // Every lead on the custodian, closed ones too, for the correction's
  // warning check. Null when they could not be listed or the staff member
  // may not edit: the custodian is then not offered for change.
  children: string[] | null
}

export type Family =
  | { kind: "family"; students: FamilyStudent[]; custodians: FamilyCustodian[] }
  | { kind: "not-found" }
  | { kind: "unavailable" }

async function readStudent(leadId: string, permissions: readonly Permission[]) {
  const supabase = await createClient()
  const lead = await getLead(supabase, leadId)
  if (!lead.ok) return lead.error
  const seesFees = permissions.includes("payments.view")
  const [details, interviews, registration, sibling, fee] = await Promise.all([
    getLeadFatherAndSchool(supabase, leadId),
    getLeadInterviews(supabase, leadId),
    getInterviewRegistration(supabase, leadId),
    readSiblingGroup(supabase, leadId, permissions),
    seesFees ? getLeadFee(supabase, leadId) : null,
  ])
  if (!details.ok) return details.error
  const open = !isClosed(lead.data)

  const here = sibling?.members.find((m) => m.here)
  const why = here?.chip.en.text ?? (fee?.ok && fee.data.kind === "fee" && fee.data.discount ? `${fee.data.discount.percent}% off` : "Full fee")
  const student: FamilyStudent = {
    lead: lead.data,
    open,
    father: details.data.fatherFullName,
    previousSchool: details.data.previousSchool,
    broughtBy: details.data.broughtBy,
    interview:
      interviews.ok && interviews.data.length > 0
        ? "registered"
        : open && registration.ok && registration.data === "first" && permissions.includes("interviews.record")
          ? "can-register"
          : "none",
    compareWith: sibling?.compareWith ?? null,
    fee: !fee
      ? null
      : !fee.ok
        ? { kind: "unavailable" }
        : fee.data.kind === "no-schedule"
          ? { kind: "no-schedule", year: fee.data.year }
          : { kind: "fee", pays: fee.data.schoolFee, why },
  }
  return student
}

export async function readFamily(leadIds: readonly string[], permissions: readonly Permission[]): Promise<Family> {
  const read = await Promise.all(leadIds.map((id) => readStudent(id, permissions)))
  if (read.some((r) => r === "not-found")) return { kind: "not-found" }
  if (read.some((r) => r === "unavailable")) return { kind: "unavailable" }
  const students = read as FamilyStudent[]

  const mayEdit = permissions.includes("leads.edit")
  const groups = byCustodian(students.map((s) => ({ contactId: s.lead.contact.id, s })))
  const custodians = await Promise.all(
    groups.map(async ({ contactId, members }): Promise<FamilyCustodian> => {
      const editable = mayEdit && members.every((m) => m.s.open)
      const children = editable ? await listContactChildren(await createClient(), contactId) : null
      return {
        contactId,
        members: members.map((m) => m.s.lead.id),
        children: children?.ok ? children.data.map((c) => c.id) : null,
      }
    }),
  )
  return { kind: "family", students, custodians }
}
