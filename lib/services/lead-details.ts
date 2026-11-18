import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The father's full name and the previous school on a lead (#299, #298),
// read and corrected on the lead record (#310). Both are corrected through
// update_lead_details, which checks leads.edit and runs the father's-name
// check against the lead's sibling group: a name close to the group's asks
// the typing-mistake question first (`father-name-question`), and nothing is
// saved until the call carries the answer. Every rule lives in the database.

// Where the father's full name came from: the student's name (`derived`),
// the same when sibling groups began (`backfilled`), typed by staff
// (`edited`), or settled as one name with a typing mistake (`typo_confirmed`).
export type FatherNameSource = "derived" | "backfilled" | "edited" | "typo_confirmed"

export type PreviousSchoolType = "private" | "public"

export type LeadPreviousSchool =
  | { kind: "school"; name: string; type: PreviousSchoolType; region: string }
  | { kind: "not-known" }
  // Not given.
  | null

export type LeadFatherAndSchool = {
  fatherFullName: string | null
  fatherFullNameSource: FatherNameSource | null
  previousSchool: LeadPreviousSchool
  // Who brought the student (#298), "Name (Relationship)"; null when nobody is recorded.
  broughtBy: string | null
}

type Row = {
  father_full_name: string | null
  father_full_name_source: FatherNameSource | null
  previous_school_name: string | null
  previous_school_type: PreviousSchoolType | null
  previous_school_region: string | null
  previous_school_not_known: boolean
  brought_by_name: string | null
  brought_by_relationship: string | null
}

export async function getLeadFatherAndSchool(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadFatherAndSchool, "not-found" | "unavailable">> {
  const { data, error } = await supabase
    .from("leads")
    .select(
      "father_full_name, father_full_name_source, previous_school_name, previous_school_type, previous_school_region, previous_school_not_known, brought_by_name, brought_by_relationship",
    )
    .eq("id", leadId)
    .maybeSingle<Row>()
  // 22P02: an id that isn't a uuid, so no lead has it.
  if (error?.code === "22P02") return { ok: false, error: "not-found" }
  if (error) {
    console.error("Could not read a lead's father's name and previous school", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: false, error: "not-found" }
  return {
    ok: true,
    data: {
      fatherFullName: data.father_full_name,
      fatherFullNameSource: data.father_full_name_source,
      previousSchool: data.previous_school_not_known
        ? { kind: "not-known" }
        : data.previous_school_name && data.previous_school_type && data.previous_school_region
          ? { kind: "school", name: data.previous_school_name, type: data.previous_school_type, region: data.previous_school_region }
          : null,
      broughtBy: data.brought_by_name
        ? data.brought_by_relationship
          ? `${data.brought_by_name} (${data.brought_by_relationship})`
          : data.brought_by_name
        : null,
    },
  }
}

export type DetailField =
  | "father_full_name"
  | "father_name_answer"
  | "father_name_spelling"
  | "previous_school_name"
  | "previous_school_type"
  | "previous_school_region"
  | "previous_school_not_known"

export type DetailCorrectionError =
  // Signed out, or without leads.edit.
  | { kind: "forbidden" }
  | { kind: "not-found" }
  // Declined, Inactive or Archived: read-only.
  | { kind: "closed" }
  | { kind: "invalid"; field: DetailField | null }
  | { kind: "unavailable" }

export type FatherNameQuestion = {
  // The name as it would be saved.
  fatherFullName: string
  // The checked sibling whose father's name is close to it.
  siblingLeadId: string
  siblingFatherFullName: string
}

export type FatherNameCorrectionError = DetailCorrectionError | ({ kind: "father-name-question" } & FatherNameQuestion)

type RpcError = { message: string; details?: string | null; code?: string }

function detailOf(details: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = details ? JSON.parse(details) : {}
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const DETAIL_FIELDS: readonly string[] = [
  "father_full_name",
  "father_name_answer",
  "father_name_spelling",
  "previous_school_name",
  "previous_school_type",
  "previous_school_region",
  "previous_school_not_known",
]

function correctionError(error: RpcError, what: string): DetailCorrectionError {
  // 42501: the function isn't granted to the caller at all.
  if (error.message === "not_permitted" || error.code === "42501") return { kind: "forbidden" }
  // 22P02: an id that isn't a uuid, so no lead has it.
  if (error.message === "not_found" || error.code === "22P02") return { kind: "not-found" }
  if (error.message === "lead_closed") return { kind: "closed" }
  if (error.message === "invalid") {
    const field = detailOf(error.details).field
    return { kind: "invalid", field: typeof field === "string" && DETAIL_FIELDS.includes(field) ? (field as DetailField) : null }
  }
  console.error(`Could not ${what}`, error)
  return { kind: "unavailable" }
}

// Corrects the father's full name on an open lead. Needs leads.edit.
// Without `answer`, a name close to the group's comes back as
// `father-name-question` and nothing is saved; send it again with the answer:
// `typo` with `spelling` (one of the two names) settles it as one name and
// writes that spelling on every record that held the other; `different`
// saves it, and the lead stops counting in its group until the Admissions
// Manager grants a Sibling request.
export async function correctFatherFullName(
  supabase: SupabaseClient,
  leadId: string,
  change: { fatherFullName: string; answer?: "typo" | "different"; spelling?: string },
): Promise<Result<null, FatherNameCorrectionError>> {
  const { error } = await supabase.rpc("update_lead_details", {
    lead_id: leadId,
    changes: {
      father_full_name: change.fatherFullName,
      ...(change.answer ? { father_name_answer: change.answer } : {}),
      ...(change.spelling !== undefined ? { father_name_spelling: change.spelling } : {}),
    },
  })
  if (!error) return { ok: true, data: null }
  if (error.message === "father_name_question") {
    const detail = detailOf(error.details)
    if (
      typeof detail.father_full_name === "string" &&
      typeof detail.sibling_lead_id === "string" &&
      typeof detail.sibling_father_full_name === "string"
    ) {
      return {
        ok: false,
        error: {
          kind: "father-name-question",
          fatherFullName: detail.father_full_name,
          siblingLeadId: detail.sibling_lead_id,
          siblingFatherFullName: detail.sibling_father_full_name,
        },
      }
    }
  }
  return { ok: false, error: correctionError(error, "correct a father's full name") }
}

// Gives or corrects the previous school on an open lead, or marks it Not
// known yet. Needs leads.edit. The database checks the name (2 to 120
// characters), the type and the region against its list.
export async function correctPreviousSchool(
  supabase: SupabaseClient,
  leadId: string,
  school: { kind: "school"; name: string; type: PreviousSchoolType; region: string } | { kind: "not-known" },
): Promise<Result<null, DetailCorrectionError>> {
  const { error } = await supabase.rpc("update_lead_details", {
    lead_id: leadId,
    changes:
      school.kind === "not-known"
        ? { previous_school_name: null, previous_school_type: null, previous_school_region: null, previous_school_not_known: true }
        : {
            previous_school_name: school.name,
            previous_school_type: school.type,
            previous_school_region: school.region,
            previous_school_not_known: false,
          },
  })
  if (!error) return { ok: true, data: null }
  return { ok: false, error: correctionError(error, "correct a previous school") }
}

// What the Sibling screens name for each lead (#310): the student's name, a
// closure mark and the father's full name. Row-level security answers only
// staff who may view leads; a lead they can't see is left out.
export type SiblingLeadFacts = {
  id: string
  studentName: string
  closure: "Inactive" | "Archived" | null
  fatherFullName: string | null
}

export async function getSiblingLeadFacts(
  supabase: SupabaseClient,
  leadIds: string[],
): Promise<Result<Map<string, SiblingLeadFacts>, "unavailable">> {
  if (leadIds.length === 0) return { ok: true, data: new Map() }
  const { data, error } = await supabase.from("leads").select("id, student_name, closure, father_full_name").in("id", leadIds)
  if (error) {
    console.error("Could not read the leads of a sibling group", error)
    return { ok: false, error: "unavailable" }
  }
  const rows = data as { id: string; student_name: string; closure: "Inactive" | "Archived" | null; father_full_name: string | null }[]
  return {
    ok: true,
    data: new Map(rows.map((r) => [r.id, { id: r.id, studentName: r.student_name, closure: r.closure, fatherFullName: r.father_full_name }])),
  }
}
