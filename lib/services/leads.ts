import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The lead module: every read and write of leads and their parent/guardian
// contacts goes through here. Writes are database functions that check the
// permission themselves; this file turns their answers into a Result.

export const LEAD_CLASSES = [
  "DAY CARE",
  "KG 1",
  "KG 2",
  "STD 1",
  "STD 2",
  "STD 3",
  "STD 4",
  "STD 5",
  "STD 6",
  "STD 7",
  "FORM 1",
  "FORM 2",
  "FORM 3",
  "FORM 4",
] as const
export type LeadClass = (typeof LEAD_CLASSES)[number]

export const RELATIONSHIPS = ["Mother", "Father", "Guardian", "Other"] as const
export type Relationship = (typeof RELATIONSHIPS)[number]

export const DAY_OR_BOARDING = ["Day", "Boarding"] as const
export type DayOrBoarding = (typeof DAY_OR_BOARDING)[number]

export type LeadStatus = "Applied" | "Visited" | "Interviewed" | "Enrolled" | "Declined"
export type LeadClosure = "Inactive" | "Archived"

export type NewContact = {
  fullName: string
  relationship: Relationship
  // Required when the relationship is Other.
  relationshipDescription?: string
  phone: string
  whatsapp?: string
}

export type NewStudent = {
  fullName: string
  className: LeadClass
  enrollmentYear: number
  dayOrBoarding: DayOrBoarding
}

export type CreateLeadInput = {
  guardian: { contactId: string } | { contact: NewContact }
  student: NewStudent
  start: { kind: "walk-in"; visitDate: string } | { kind: "admission-form" }
}

// The form field a refusal is about, named the way the screens name them.
export type InvalidField =
  | "start"
  | "contact"
  | "contact_name"
  | "relationship"
  | "relationship_description"
  | "phone"
  | "whatsapp"
  | "student_name"
  | "class_name"
  | "enrollment_year"
  | "day_or_boarding"
  | "visit_date"

export type ExistingLead = {
  id: string
  admissionNumber: string
  status: LeadStatus
  closure: LeadClosure | null
}

export type CreateLeadError =
  | { kind: "duplicate"; lead: ExistingLead }
  | { kind: "forbidden" }
  | { kind: "invalid"; field: InvalidField | null }
  | { kind: "unavailable" }

export type CreatedLead = { leadId: string; admissionNumber: string }

type CreateLeadRow =
  | { result: "created"; lead_id: string; admission_number: string }
  | { result: "duplicate"; lead_id: string; admission_number: string; status: LeadStatus; closure: LeadClosure | null }

function invalidFieldOf(details: string | null | undefined): InvalidField | null {
  try {
    const parsed = details ? (JSON.parse(details) as { field?: InvalidField }) : {}
    return parsed.field ?? null
  } catch {
    return null
  }
}

// Creates a lead. A student who is already on file, under any status or
// closure mark, comes back as `duplicate` with the lead that matches, so the
// caller decides what that means: the front desk shows it, and the Admission
// form records a re-application.
export async function createLead(
  supabase: SupabaseClient,
  input: CreateLeadInput,
): Promise<Result<CreatedLead, CreateLeadError>> {
  const { guardian, student, start } = input
  const { data, error } = await supabase.rpc("create_lead", {
    start_kind: start.kind === "walk-in" ? "walk_in" : "admission_form",
    existing_contact_id: "contactId" in guardian ? guardian.contactId : null,
    new_contact:
      "contact" in guardian
        ? {
            full_name: guardian.contact.fullName,
            relationship: guardian.contact.relationship,
            relationship_description: guardian.contact.relationshipDescription ?? null,
            phone: guardian.contact.phone,
            whatsapp: guardian.contact.whatsapp ?? null,
          }
        : null,
    student_details: {
      full_name: student.fullName,
      class_name: student.className,
      enrollment_year: student.enrollmentYear,
      day_or_boarding: student.dayOrBoarding,
    },
    visited_on: start.kind === "walk-in" ? start.visitDate : null,
  })

  if (error) {
    if (error.message === "not_permitted") return { ok: false, error: { kind: "forbidden" } }
    if (error.message === "invalid") {
      return { ok: false, error: { kind: "invalid", field: invalidFieldOf(error.details) } }
    }
    console.error("Could not create a lead", error)
    return { ok: false, error: { kind: "unavailable" } }
  }

  const row = data as CreateLeadRow
  if (row.result === "duplicate") {
    return {
      ok: false,
      error: {
        kind: "duplicate",
        lead: {
          id: row.lead_id,
          admissionNumber: row.admission_number,
          status: row.status,
          closure: row.closure,
        },
      },
    }
  }
  return { ok: true, data: { leadId: row.lead_id, admissionNumber: row.admission_number } }
}

export type Lead = {
  id: string
  admissionNumber: string
  studentName: string
  className: LeadClass
  enrollmentYear: number
  dayOrBoarding: DayOrBoarding
  status: LeadStatus
  closure: LeadClosure | null
  visitDate: string | null
  returningFamily: boolean
  contact: {
    id: string
    fullName: string
    relationship: Relationship
    relationshipDescription: string | null
    phone: string
    whatsapp: string | null
  }
}

type LeadRow = {
  id: string
  admission_number: string
  student_name: string
  class_name: LeadClass
  enrollment_year: number
  day_or_boarding: DayOrBoarding
  status: LeadStatus
  closure: LeadClosure | null
  visit_date: string | null
  returning_family_joined: boolean
  returning_family_reapplied: boolean
  guardian_contacts: {
    id: string
    full_name: string
    relationship: Relationship
    relationship_description: string | null
    phone: string
    whatsapp: string | null
  }
}

// Whether the lead has been closed by a decline or a closure mark, which
// makes it read-only until a reopening.
export function isClosed(lead: { status: LeadStatus; closure: LeadClosure | null }) {
  return lead.status === "Declined" || lead.closure !== null
}

// An Admission Number as staff type it: ADMSN- in any case, or the five digits
// alone, with spaces around. Anything else is not an Admission Number.
export function parseAdmissionNumber(typed: string): string | null {
  const match = /^(?:ADMSN-)?(\d{5})$/i.exec(typed.trim())
  return match ? `ADMSN-${match[1]}` : null
}

// The id of the lead with this Admission Number, whatever its status or
// closure mark. Row-level security hides every lead from anyone without
// leads.view, so for them nothing is found.
export async function findLeadByAdmissionNumber(
  supabase: SupabaseClient,
  typed: string,
): Promise<Result<string, "not-found" | "unavailable">> {
  const admissionNumber = parseAdmissionNumber(typed)
  if (!admissionNumber) return { ok: false, error: "not-found" }

  const { data, error } = await supabase
    .from("leads")
    .select("id")
    .eq("admission_number", admissionNumber)
    .maybeSingle<{ id: string }>()

  if (error) {
    console.error("Could not look up an Admission Number", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: false, error: "not-found" }
  return { ok: true, data: data.id }
}

// One lead with its contact, for a signed-in staff member who may view
// leads. Row-level security returns nothing to anyone else, which reads as
// not found.
export async function getLead(supabase: SupabaseClient, id: string): Promise<Result<Lead, "not-found" | "unavailable">> {
  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, closure, visit_date, returning_family_joined, returning_family_reapplied, guardian_contacts!guardian_contact_id (id, full_name, relationship, relationship_description, phone, whatsapp)",
    )
    .eq("id", id)
    .maybeSingle<LeadRow>()

  // A malformed id is a missing lead, not an outage.
  if (error && error.code === "22P02") return { ok: false, error: "not-found" }
  if (error) {
    console.error("Could not read a lead", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: false, error: "not-found" }

  return {
    ok: true,
    data: {
      id: data.id,
      admissionNumber: data.admission_number,
      studentName: data.student_name,
      className: data.class_name,
      enrollmentYear: data.enrollment_year,
      dayOrBoarding: data.day_or_boarding,
      status: data.status,
      closure: data.closure,
      visitDate: data.visit_date,
      returningFamily: data.returning_family_joined || data.returning_family_reapplied,
      contact: {
        id: data.guardian_contacts.id,
        fullName: data.guardian_contacts.full_name,
        relationship: data.guardian_contacts.relationship,
        relationshipDescription: data.guardian_contacts.relationship_description,
        phone: data.guardian_contacts.phone,
        whatsapp: data.guardian_contacts.whatsapp,
      },
    },
  }
}
