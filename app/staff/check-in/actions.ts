"use server"

import {
  createLead,
  DAY_OR_BOARDING,
  findLeadByAdmissionNumber,
  LEAD_CLASSES,
  RELATIONSHIPS,
  type NewContact,
  type NewStudent,
} from "@/lib/services/leads"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { refusalOutcome, type LookupOutcome, type RegisterOutcome } from "./outcome"

// Finds the lead a family's Admission Number belongs to, for anyone who may
// view leads.
export async function lookUpAdmissionNumber(typed: string): Promise<LookupOutcome> {
  if (typeof typed !== "string") return { status: "not-found" }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.view")
  if (!allowed.ok) return { status: "refused", message: "Your role can't look up leads." }

  const result = await findLeadByAdmissionNumber(supabase, typed)
  if (result.ok) return { status: "found", href: `/staff/leads/${result.data}` }
  if (result.error === "not-found") return { status: "not-found" }
  return { status: "refused", message: "The lookup could not be completed. Try again in a moment." }
}

export type WalkInForm = {
  contact: NewContact
  student: NewStudent
  visitDate: string
}

const REFUSED_INPUT: RegisterOutcome = {
  status: "refused",
  step: "review",
  field: null,
  message: "Some details could not be read. Reload the page and try again.",
}

// Server Actions take input from anyone who can post to them, so the shape is
// checked before it reaches the database, which then checks the rules.
function isWalkInForm(form: WalkInForm): boolean {
  const { contact, student, visitDate } = form ?? {}
  return (
    typeof contact?.fullName === "string" &&
    (RELATIONSHIPS as readonly string[]).includes(contact.relationship) &&
    typeof contact.phone === "string" &&
    typeof student?.fullName === "string" &&
    (LEAD_CLASSES as readonly string[]).includes(student.className) &&
    Number.isInteger(student.enrollmentYear) &&
    (DAY_OR_BOARDING as readonly string[]).includes(student.dayOrBoarding) &&
    typeof visitDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(visitDate)
  )
}

// Registers a walk-in family: a new contact and a Visited lead. The database
// checks that the staff member may, and refuses a child who is already on file.
export async function registerWalkIn(form: WalkInForm): Promise<RegisterOutcome> {
  if (!isWalkInForm(form)) return REFUSED_INPUT

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.create")
  if (!allowed.ok) return refusalOutcome({ kind: "forbidden" })

  const { contact, student, visitDate } = form
  const result = await createLead(supabase, {
    guardian: {
      contact: {
        fullName: contact.fullName,
        relationship: contact.relationship,
        relationshipDescription: contact.relationshipDescription,
        phone: contact.phone,
        whatsapp: contact.whatsapp,
      },
    },
    student: {
      fullName: student.fullName,
      className: student.className,
      enrollmentYear: student.enrollmentYear,
      dayOrBoarding: student.dayOrBoarding,
    },
    start: { kind: "walk-in", visitDate },
  })

  if (!result.ok) return refusalOutcome(result.error)
  return { status: "created", leadId: result.data.leadId, admissionNumber: result.data.admissionNumber }
}
