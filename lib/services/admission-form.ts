import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AdmissionChild, AdmissionForm, AdmissionParent, ChildField, NamePart, ParentField } from "@/lib/admission-form"

import { applyFormDiscountCode, formDiscountCodeToKeep } from "./referral"
import type { Result } from "./result"

// The Admission form's writes. Each child becomes an Applied lead through
// slice 2's create_lead with the Admission form start, inside
// submit_admission_form_child, which also stores the child's outcome under the
// form's submission key in the same transaction. So a parent who sends the
// same form twice (a dropped connection, a double tap) gets the same
// Admission Numbers back and nothing new is created.
//
// A child already on file gets no second lead. The same call records it as a
// Re-application on the lead it matched, and the parent gets that lead's
// Admission Number, exactly as for a new child.
//
// Children are handled one call at a time, in form order. The first created
// child makes the parent's contact; every later child on the form is created
// on that contact, so siblings share it. A failure part way leaves the
// children already handled stored, and a retry with the same key resumes.
//
// A Discount code on the form is one for every child. Each child the form
// creates gets it on its lead, recognised or not, right after the child is
// created, and again when a retry replays that child: the code is written only
// into an empty one, so the replay finishes a step a dropped connection cut
// off and never overwrites a code staff set since. A child already on file
// gets nothing on its lead: the code travels in the child's details to
// record_re_application, which keeps it on the Re-application for staff to
// compare and Apply (#84). create_lead ignores it.
//
// The code-holder notice's version (#182) goes with the code onto each lead,
// and stays out of the submission key's hash, so a retry from a page loaded
// before or after a deploy that changed the notice is the same send.
//
// Names come in their parts (prototype v38, #400) or in the live form's one
// box; the database builds and stores the full names from the parts. A part
// it refuses comes back as the child's `student_name` or the parent's
// `contact_name`, with `part` naming the box.
//
// Takes the secret-key client (utils/supabase/public-form.ts): only the
// secret key may use the Admission form start.

export type ChildOutcome = {
  fullName: string
  admissionNumber: string
}

export type AdmissionFormError =
  // A field the database refused. `child` is the child card for a child's
  // field, null for the parent's. `duplicate_child` is a child the form
  // already named on an earlier card.
  | { kind: "invalid"; field: ParentField | ChildField | "discount_code" | "payload"; child: number | null; part?: NamePart }
  // This submission key already created children, from an earlier send of
  // the form before the parent edited it. Those children, in form order, and
  // whether they are every child that send carried.
  | { kind: "already-sent"; children: ChildOutcome[]; complete: boolean }
  | { kind: "unavailable" }

type ChildRow =
  | { result: "created" | "re_applied"; lead_id: string; admission_number: string; replayed: boolean }
  | { result: "duplicate"; lead_id: string; admission_number: string }

const PARENT_FIELDS = new Set<string>(["contact_name", "relationship", "relationship_description", "phone", "whatsapp"])
const CHILD_FIELDS = new Set<string>(["student_name", "class_name", "enrollment_year", "day_or_boarding", "duplicate_child"])
const FORM_FIELDS = new Set<string>(["discount_code"])
const PARENT_PARTS = new Set<string>(["contact_first_name", "contact_middle_name", "contact_last_name"])
const CHILD_PARTS = new Set<string>(["first_name", "father_first", "father_middle", "father_last"])

// What the submission key is checked against: the form exactly as validated,
// in a fixed key order. The Discount code joins it only when there is one, so
// a form without a code hashes as it did before codes existed, and a name's
// parts only when it came in parts, so a one-box form hashes as before #400.
export function payloadHash({ parent, children, discountCode }: Pick<AdmissionForm, "parent" | "children" | "discountCode">): string {
  const canonical = JSON.stringify({
    ...(discountCode ? { discountCode } : {}),
    parent: [
      parent.fullName,
      parent.relationship,
      parent.relationshipDescription ?? null,
      parent.phone,
      parent.whatsapp ?? null,
      ...(parent.nameParts ? [[parent.nameParts.firstName, parent.nameParts.middleName, parent.nameParts.lastName]] : []),
    ],
    children: children.map((c) => [
      c.fullName,
      c.className,
      c.enrollmentYear,
      c.dayOrBoarding,
      ...(c.nameParts
        ? [[c.nameParts.firstName, c.nameParts.fatherFirst, c.nameParts.fatherMiddle, c.nameParts.fatherLast]]
        : []),
      // Only when given, so a form sent before the question keeps its key.
      ...(c.gender ? [{ gender: c.gender }] : []),
    ]),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

function studentDetails(child: AdmissionChild, discountCode: string | undefined) {
  const parts = child.nameParts
  return {
    ...(parts
      ? {
          first_name: parts.firstName,
          father_first: parts.fatherFirst,
          father_middle: parts.fatherMiddle,
          father_last: parts.fatherLast,
        }
      : { full_name: child.fullName }),
    class_name: child.className,
    enrollment_year: child.enrollmentYear,
    day_or_boarding: child.dayOrBoarding,
    ...(child.gender ? { gender: child.gender } : {}),
    ...(discountCode ? { discount_code: discountCode } : {}),
  }
}

function contactName(parent: AdmissionParent) {
  const parts = parent.nameParts
  return parts
    ? { first_name: parts.firstName, middle_name: parts.middleName, last_name: parts.lastName }
    : { full_name: parent.fullName }
}

function fieldOf(details: string | null | undefined): string | null {
  try {
    return details ? ((JSON.parse(details) as { field?: string }).field ?? null) : null
  } catch {
    return null
  }
}

function earlierSend(details: string | null | undefined): { children: ChildOutcome[]; complete: boolean } | null {
  try {
    const sent = details
      ? (JSON.parse(details) as { complete?: unknown; children?: { full_name?: unknown; admission_number?: unknown }[] })
      : null
    const rows = sent?.children
    if (typeof sent?.complete !== "boolean" || !Array.isArray(rows) || rows.length === 0) return null
    const children = rows.map((row) => ({ fullName: row.full_name, admissionNumber: row.admission_number }))
    return children.every((c) => typeof c.fullName === "string" && typeof c.admissionNumber === "string")
      ? { children: children as ChildOutcome[], complete: sent.complete }
      : null
  } catch {
    return null
  }
}

export async function submitAdmissionForm(
  supabase: SupabaseClient,
  form: AdmissionForm,
): Promise<Result<ChildOutcome[], AdmissionFormError>> {
  const { submissionKey, parent, children, noticeVersion } = form
  // The hash takes the code as sent, so a retry is the same send whatever the
  // lookup below finds; the leads keep a Promo code without the box's hyphen.
  const hash = payloadHash(form)
  const discountCode = form.discountCode ? await formDiscountCodeToKeep(supabase, form.discountCode) : undefined
  const newContact = {
    ...contactName(parent),
    relationship: parent.relationship,
    relationship_description: parent.relationshipDescription ?? null,
    phone: parent.phone,
    whatsapp: parent.whatsapp ?? null,
  }

  const outcomes: ChildOutcome[] = []
  for (const [index, child] of children.entries()) {
    const { data, error } = await supabase.rpc("submit_admission_form_child", {
      submission_key: submissionKey,
      payload_hash: hash,
      child_count: children.length,
      child_index: index,
      new_contact: newContact,
      student_details: studentDetails(child, discountCode),
    })

    if (error) {
      if (error.message === "submission_key_reused") {
        const sent = earlierSend(error.details)
        if (sent) return { ok: false, error: { kind: "already-sent", ...sent } }
      }
      if (error.message === "invalid") {
        const field = fieldOf(error.details)
        if (field && PARENT_PARTS.has(field)) {
          return { ok: false, error: { kind: "invalid", field: "contact_name", child: null, part: field as NamePart } }
        }
        if (field && CHILD_PARTS.has(field)) {
          return { ok: false, error: { kind: "invalid", field: "student_name", child: index, part: field as NamePart } }
        }
        // The father's three names together are too long.
        if (field === "father_full_name") {
          return { ok: false, error: { kind: "invalid", field: "student_name", child: index } }
        }
        if (field && PARENT_FIELDS.has(field)) {
          return { ok: false, error: { kind: "invalid", field: field as ParentField, child: null } }
        }
        if (field && FORM_FIELDS.has(field)) {
          return { ok: false, error: { kind: "invalid", field: "discount_code", child: null } }
        }
        // No screen asks Boy or girl yet (#449 slice 2 adds the step and its
        // words), so a refused answer is a malformed form, not an outage.
        if (field === "gender") {
          return { ok: false, error: { kind: "invalid", field: "payload", child: null } }
        }
        if (field && CHILD_FIELDS.has(field)) {
          return {
            ok: false,
            error: { kind: "invalid", field: field as ChildField, child: index },
          }
        }
      }
      console.error("Admission form: could not handle a child", { index, message: error.message, details: error.details })
      return { ok: false, error: { kind: "unavailable" } }
    }

    const row = data as ChildRow
    if (row.result !== "created" && row.result !== "re_applied") {
      console.error("Admission form: unexpected outcome for a child", { index, result: row.result })
      return { ok: false, error: { kind: "unavailable" } }
    }
    if (row.result === "created" && discountCode) {
      const applied = await applyFormDiscountCode(supabase, row.lead_id, discountCode, noticeVersion ?? null)
      if (!applied.ok) {
        if (applied.error === "invalid") return { ok: false, error: { kind: "invalid", field: "discount_code", child: null } }
        // Staff closed the lead before the code reached it: it stays as they
        // left it, and the parent's application still stands.
        if (applied.error !== "lead-closed") {
          console.error("Admission form: could not put the Discount code on a lead", { index, error: applied.error })
          return { ok: false, error: { kind: "unavailable" } }
        }
      }
    }
    outcomes.push({ fullName: child.fullName, admissionNumber: row.admission_number })
  }

  return { ok: true, data: outcomes }
}
