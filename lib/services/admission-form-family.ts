import type { SupabaseClient } from "@supabase/supabase-js"

import type { DayOrBoarding, LeadClass, LeadClosure, LeadStatus, Relationship, StudentGender } from "./leads"
import type { Result } from "./result"

// The Admission form family of one lead (#309): what the form already gave,
// so check-in asks only the rest. The database function
// admission_form_family reads it, under leads.view (see its migration).

export type FormChild = {
  leadId: string
  admissionNumber: string
  studentName: string
  fatherFullName: string | null
  gender: StudentGender | null
  className: LeadClass
  enrollmentYear: number
  dayOrBoarding: DayOrBoarding
  status: LeadStatus
  closure: LeadClosure | null
  previousSchool: { name: string; type: "private" | "public"; region: string } | { notKnown: true } | null
  broughtByName: string | null
  // The parent this child sits on. One child can sit on a copy of the form's parent (separate_from_family).
  contactId: string | null
  // Already in a sibling group outside the old family rule: check-in keeps that link.
  linked: boolean
  // That group, when linked.
  groupId: string | null
}

export type FormContact = {
  id: string
  fullName: string
  relationship: Relationship
  relationshipDescription: string | null
  phone: string
  whatsapp: string | null
  // A Family match waits on this parent: it is settled on the record first.
  familyMatch: boolean
}

export type OnFileChild = {
  leadId: string
  admissionNumber: string
  studentName: string
  className: LeadClass
  status: LeadStatus
  closure: LeadClosure | null
  fatherFullName: string | null
}

export type AdmissionFormFamily = {
  sentOn: string
  contact: FormContact | null
  children: FormChild[]
  onFile: OnFileChild[]
}

export type AdmissionFormFamilyError = "not-found" | "not-admission-form" | "forbidden" | "unavailable"

type Row = Record<string, unknown>

const text = (v: unknown) => (typeof v === "string" ? v : null)

function child(r: Row): FormChild {
  const school = text(r.previous_school_name)
  return {
    leadId: r.lead_id as string,
    admissionNumber: r.admission_number as string,
    studentName: r.student_name as string,
    fatherFullName: text(r.father_full_name),
    gender: (text(r.gender) as StudentGender | null) ?? null,
    className: r.class_name as LeadClass,
    enrollmentYear: Number(r.enrollment_year),
    dayOrBoarding: r.day_or_boarding as DayOrBoarding,
    status: r.status as LeadStatus,
    closure: (text(r.closure) as LeadClosure | null) ?? null,
    previousSchool:
      r.previous_school_not_known === true
        ? { notKnown: true }
        : school
          ? { name: school, type: r.previous_school_type === "private" ? "private" : "public", region: text(r.previous_school_region) ?? "" }
          : null,
    broughtByName: text(r.brought_by_name),
    contactId: text(r.contact_id),
    linked: r.linked === true,
    groupId: text(r.group_id),
  }
}

/** The family of the Admission form that created this lead, or why there is none. */
export async function getAdmissionFormFamily(supabase: SupabaseClient, leadId: string): Promise<Result<AdmissionFormFamily, AdmissionFormFamilyError>> {
  const { data, error } = await supabase.rpc("admission_form_family", { lead_id: leadId })
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    if (error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not read the Admission form family", error)
    return { ok: false, error: "unavailable" }
  }
  const row = data as Row
  if (row.result === "not_found") return { ok: false, error: "not-found" }
  if (row.result === "not_admission_form") return { ok: false, error: "not-admission-form" }
  const c = row.contact as Row | null
  return {
    ok: true,
    data: {
      sentOn: row.sent_on as string,
      contact: c
        ? {
            id: c.id as string,
            fullName: c.full_name as string,
            relationship: c.relationship as Relationship,
            relationshipDescription: text(c.relationship_description),
            phone: c.phone as string,
            whatsapp: text(c.whatsapp),
            familyMatch: c.family_match === true,
          }
        : null,
      children: (row.children as Row[]).map(child),
      onFile: (row.on_file as Row[]).map((r) => ({
        leadId: r.lead_id as string,
        admissionNumber: r.admission_number as string,
        studentName: r.student_name as string,
        className: r.class_name as LeadClass,
        status: r.status as LeadStatus,
        closure: (text(r.closure) as LeadClosure | null) ?? null,
        fatherFullName: text(r.father_full_name),
      })),
    },
  }
}

/** The children check-in completes: those still Applied and open (complete_admission_visit, rule 1). */
export const waitingChildren = (family: AdmissionFormFamily) => family.children.filter((c) => c.status === "Applied" && c.closure === null)
