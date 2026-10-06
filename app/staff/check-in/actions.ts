"use server"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createLead,
  DAY_OR_BOARDING,
  findFamilyByPhone,
  findLeadByAdmissionNumber,
  LEAD_CLASSES,
  RELATIONSHIPS,
  updateGuardianContact,
  type NewContact,
  type NewStudent,
} from "@/lib/services/leads"
import { setLeadReferralCode } from "@/lib/services/referral"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { correctionOutcome, type CorrectionOutcome } from "../leads/[id]/correction-outcome"
import {
  familyRefusal,
  refusalOutcome,
  type FamilyOutcome,
  type LookupOutcome,
  type ReferralCodeResult,
  type RegisterOutcome,
} from "./outcome"

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

// The parent of a walk-in: a contact staff confirmed as the same person, with
// the numbers staff typed for them, or the details of a new one.
export type WalkInGuardian = { contactId: string; typedPhones: string[] } | { contact: NewContact }

export type WalkInForm = {
  guardian: WalkInGuardian
  student: NewStudent
  visitDate: string
  // The Marketing Agent's code staff entered. Null or left out for none, so
  // a page loaded before the field existed still registers.
  referralCode?: string | null
}

const REFUSED_INPUT: RegisterOutcome = {
  status: "refused",
  step: "review",
  field: null,
  message: "Some details could not be read. Reload the page and try again.",
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isContact(contact: NewContact | undefined): contact is NewContact {
  return (
    typeof contact?.fullName === "string" &&
    (RELATIONSHIPS as readonly string[]).includes(contact.relationship) &&
    typeof contact.phone === "string" &&
    (contact.relationshipDescription === undefined || typeof contact.relationshipDescription === "string") &&
    (contact.whatsapp === undefined || typeof contact.whatsapp === "string")
  )
}

function isGuardian(guardian: WalkInGuardian | undefined): guardian is WalkInGuardian {
  if (!guardian || typeof guardian !== "object") return false
  if ("contactId" in guardian) {
    return (
      typeof guardian.contactId === "string" &&
      UUID.test(guardian.contactId) &&
      Array.isArray(guardian.typedPhones) &&
      guardian.typedPhones.length <= 2 &&
      guardian.typedPhones.every((phone) => typeof phone === "string")
    )
  }
  return isContact(guardian.contact)
}

// Server Actions take input from anyone who can post to them, so the shape is
// checked before it reaches the database, which then checks the rules.
function isWalkInForm(form: WalkInForm): boolean {
  const { guardian, student, visitDate, referralCode } = form ?? {}
  return (
    // No code is longer than 20 characters, spaces aside.
    (referralCode == null || (typeof referralCode === "string" && referralCode.length <= 60)) &&
    isGuardian(guardian) &&
    typeof student?.fullName === "string" &&
    (LEAD_CLASSES as readonly string[]).includes(student.className) &&
    Number.isInteger(student.enrollmentYear) &&
    (DAY_OR_BOARDING as readonly string[]).includes(student.dayOrBoarding) &&
    typeof visitDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(visitDate)
  )
}

// Looks for a known Family by the parent's numbers, before any child is
// typed. Names are never compared. A role that may register but not view
// leads skips the match and registers a new contact; the duplicate check
// still runs when the lead is created.
export async function findFamily(numbers: { phone: string; whatsapp: string | null }): Promise<FamilyOutcome> {
  if (typeof numbers?.phone !== "string" || (numbers.whatsapp !== null && typeof numbers.whatsapp !== "string")) {
    return { status: "refused", field: null, message: "Some details could not be read. Reload the page and try again." }
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.view")
  if (!allowed.ok && allowed.error === "forbidden") return { status: "skipped" }
  if (!allowed.ok) return familyRefusal({ kind: "unavailable" })

  const result = await findFamilyByPhone(supabase, { phone: numbers.phone, whatsapp: numbers.whatsapp })
  if (!result.ok) return familyRefusal(result.error)
  return { status: "found", match: result.data }
}

export type SharedContactUpdate = {
  contactId: string
  contact: NewContact
  // The children staff were shown, who all share the contact.
  children: string[]
}

// Updates the contact a confirmed parent shares with their children to the
// details staff typed. Needs leads.edit and is audited; a contact whose
// children changed since staff saw them is refused.
export async function updateSharedContact(update: SharedContactUpdate): Promise<CorrectionOutcome> {
  const { contactId, contact, children } = update ?? {}
  if (
    typeof contactId !== "string" ||
    !UUID.test(contactId) ||
    !isContact(contact) ||
    !Array.isArray(children) ||
    !children.every((id) => typeof id === "string" && UUID.test(id))
  ) {
    return { status: "refused", field: null, message: "Some details could not be read. Reload the page and try again." }
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return correctionOutcome({ kind: "forbidden" })

  const result = await updateGuardianContact(
    supabase,
    contactId,
    {
      fullName: contact.fullName,
      relationship: contact.relationship,
      relationshipDescription: contact.relationship === "Other" ? (contact.relationshipDescription ?? "") : null,
      phone: contact.phone,
      whatsapp: contact.whatsapp ?? null,
    },
    children,
  )
  if (!result.ok) return correctionOutcome(result.error)
  return { status: "saved" }
}

// Registers a walk-in: a Visited lead, on a new contact or on one staff
// confirmed, which joins the child to that Family as Returning family. The
// database checks that the staff member may, and refuses a child who is
// already on file.
export async function registerWalkIn(form: WalkInForm): Promise<RegisterOutcome> {
  if (!isWalkInForm(form)) return REFUSED_INPUT

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.create")
  if (!allowed.ok) return refusalOutcome({ kind: "forbidden" })

  const { guardian, student, visitDate, referralCode } = form
  const result = await createLead(supabase, {
    guardian:
      "contactId" in guardian
        ? { contactId: guardian.contactId, alsoCheckPhones: guardian.typedPhones }
        : {
            contact: {
              fullName: guardian.contact.fullName,
              relationship: guardian.contact.relationship,
              relationshipDescription: guardian.contact.relationshipDescription,
              phone: guardian.contact.phone,
              whatsapp: guardian.contact.whatsapp,
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

  const { leadId, admissionNumber } = result.data
  return { status: "created", leadId, admissionNumber, referralCode: await putReferralCode(supabase, leadId, referralCode) }
}

// Puts the Referral code on the lead just created. The lead exists whatever
// happens here, so a failure is reported, not thrown: staff add the code on
// the lead's Referral code panel instead. The form only sends a code an agent
// holds, so a failure is in practice the database not answering.
async function putReferralCode(
  supabase: SupabaseClient,
  leadId: string,
  code: string | null | undefined,
): Promise<ReferralCodeResult> {
  if (code == null || code.trim() === "") return "none"
  try {
    const saved = await setLeadReferralCode(supabase, leadId, code)
    if (saved.ok) return "saved"
    console.error("A new lead's Referral code was not saved", saved.error)
  } catch (error) {
    console.error("A new lead's Referral code was not saved", error)
  }
  return "not-saved"
}
