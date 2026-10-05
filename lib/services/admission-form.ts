import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AdmissionChild, AdmissionForm, ChildField, ParentField } from "@/lib/admission-form"

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
// Takes the secret-key client (utils/supabase/public-form.ts): only the
// secret key may use the Admission form start.

export type ChildOutcome = {
  fullName: string
  admissionNumber: string
}

export type AdmissionFormError =
  // A field the database refused. `child` is the child card for a child's
  // field, null for the parent's.
  | { kind: "invalid"; field: ParentField | Exclude<ChildField, "duplicate_child">; child: number | null }
  // This submission key already created children, from an earlier send of
  // the form before the parent edited it. Those children, in form order, and
  // whether they are every child that send carried.
  | { kind: "already-sent"; children: ChildOutcome[]; complete: boolean }
  | { kind: "unavailable" }

type ChildRow =
  | { result: "created" | "re_applied"; lead_id: string; admission_number: string; replayed: boolean }
  | { result: "duplicate"; lead_id: string; admission_number: string }

const PARENT_FIELDS = new Set<string>(["contact_name", "relationship", "relationship_description", "phone", "whatsapp"])
const CHILD_FIELDS = new Set<string>(["student_name", "class_name", "enrollment_year", "day_or_boarding"])

// What the submission key is checked against: the form exactly as validated,
// in a fixed key order.
function payloadHash({ parent, children }: Pick<AdmissionForm, "parent" | "children">): string {
  const canonical = JSON.stringify({
    parent: [
      parent.fullName,
      parent.relationship,
      parent.relationshipDescription ?? null,
      parent.phone,
      parent.whatsapp ?? null,
    ],
    children: children.map((c) => [c.fullName, c.className, c.enrollmentYear, c.dayOrBoarding]),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

function studentDetails(child: AdmissionChild) {
  return {
    full_name: child.fullName,
    class_name: child.className,
    enrollment_year: child.enrollmentYear,
    day_or_boarding: child.dayOrBoarding,
  }
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
  const { submissionKey, parent, children } = form
  const hash = payloadHash(form)
  const newContact = {
    full_name: parent.fullName,
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
      student_details: studentDetails(child),
    })

    if (error) {
      if (error.message === "submission_key_reused") {
        const sent = earlierSend(error.details)
        if (sent) return { ok: false, error: { kind: "already-sent", ...sent } }
      }
      if (error.message === "invalid") {
        const field = fieldOf(error.details)
        if (field && PARENT_FIELDS.has(field)) {
          return { ok: false, error: { kind: "invalid", field: field as ParentField, child: null } }
        }
        if (field && CHILD_FIELDS.has(field)) {
          return {
            ok: false,
            error: { kind: "invalid", field: field as Exclude<ChildField, "duplicate_child">, child: index },
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
    outcomes.push({ fullName: child.fullName, admissionNumber: row.admission_number })
  }

  return { ok: true, data: outcomes }
}
