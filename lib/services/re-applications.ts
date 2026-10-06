import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { DayOrBoarding, LeadClass, LeadClosure, LeadStatus, Relationship } from "./leads"
import type { Result } from "./result"

// The re-application module: staff reading and reviewing Re-applications.
// The Admission form records them (record_re_application, through the
// admission-form service). Reads rely on row-level security, which shows them
// only to staff who may view leads; Mark reviewed is a database function that
// checks leads.edit itself.

export const RE_APPLICATIONS_PER_PAGE = 50

// The queue shows the unreviewed ones; Show reviewed, the reviewed ones.
export type ReApplicationFilter = "unreviewed" | "reviewed"

// The Admission form's field names, as re_applications.differing_fields holds
// them.
export type ReApplicationField =
  | "student_name"
  | "class_name"
  | "enrollment_year"
  | "day_or_boarding"
  | "contact_name"
  | "relationship"
  | "relationship_description"
  | "phone"
  | "whatsapp"

export type ReApplicationSummary = {
  id: string
  leadId: string
  // The lead's, as it stands now.
  admissionNumber: string
  studentName: string
  status: LeadStatus
  closure: LeadClosure | null
  receivedAt: string
  // What differed from the lead and its contact when it arrived.
  differingFields: ReApplicationField[]
  reviewedAt: string | null
  // The reviewer's name, looked up now. Null while unreviewed.
  reviewedBy: string | null
}

// What the family sent. The numbers as the database normalized them, and as
// the family typed them.
export type SubmittedDetails = {
  contactName: string
  relationship: Relationship
  relationshipDescription: string | null
  phone: string
  phoneAsSent: string
  // Null when none was sent, or it was the same as the phone.
  whatsapp: string | null
  // Null when none was sent.
  whatsappAsSent: string | null
  studentName: string
  className: LeadClass
  enrollmentYear: number
  dayOrBoarding: DayOrBoarding
}

export type ReApplication = ReApplicationSummary & { submitted: SubmittedDetails }

export type ReApplicationList = {
  reApplications: ReApplicationSummary[]
  total: number
  page: number
  pageCount: number
}

export type MarkReviewedError = "forbidden" | "not-found" | "no-change" | "unavailable"

type Row = {
  id: string
  lead_id: string
  received_at: string
  differing_fields: ReApplicationField[]
  reviewed_at: string | null
  lead: { admission_number: string; student_name: string; status: LeadStatus; closure: LeadClosure | null }
}

type DetailRow = Row & {
  contact_name: string
  relationship: Relationship
  relationship_description: string | null
  phone: string
  phone_as_sent: string
  whatsapp: string | null
  whatsapp_as_sent: string | null
  student_name: string
  class_name: LeadClass
  enrollment_year: number
  day_or_boarding: DayOrBoarding
}

const COLUMNS =
  "id, lead_id, received_at, differing_fields, reviewed_at, lead:leads!inner(admission_number, student_name, status, closure)"
const DETAIL_COLUMNS = `${COLUMNS}, contact_name, relationship, relationship_description, phone, phone_as_sent, whatsapp, whatsapp_as_sent, student_name, class_name, enrollment_year, day_or_boarding`

// The reviewers' names, by re-application id.
async function reviewers(supabase: SupabaseClient, rows: Row[]): Promise<Result<Map<string, string>, "unavailable">> {
  const ids = rows.filter((row) => row.reviewed_at !== null).map((row) => row.id)
  const names = new Map<string, string>()
  if (ids.length === 0) return { ok: true, data: names }
  const { data, error } = await supabase.rpc("re_application_reviewers", { re_application_ids: ids })
  if (error) {
    console.error("Could not read who reviewed the re-applications", error)
    return { ok: false, error: "unavailable" }
  }
  for (const row of data as { re_application_id: string; reviewer_name: string }[]) {
    names.set(row.re_application_id, row.reviewer_name)
  }
  return { ok: true, data: names }
}

function toSummary(row: Row, names: Map<string, string>): ReApplicationSummary {
  return {
    id: row.id,
    leadId: row.lead_id,
    admissionNumber: row.lead.admission_number,
    studentName: row.lead.student_name,
    status: row.lead.status,
    closure: row.lead.closure,
    receivedAt: row.received_at,
    differingFields: row.differing_fields,
    reviewedAt: row.reviewed_at,
    reviewedBy: names.get(row.id) ?? null,
  }
}

// One page of the queue. Unreviewed is oldest first, the order they are
// reviewed in; reviewed is the latest review first. Staff without leads.view
// read an empty list.
export async function listReApplications(
  supabase: SupabaseClient,
  search: { filter: ReApplicationFilter; page: number },
): Promise<Result<ReApplicationList, "unavailable">> {
  const page = Number.isInteger(search.page) && search.page > 0 ? search.page : 1

  const build = (head = false) => {
    const list = supabase.from("re_applications").select(COLUMNS, { count: "exact", head })
    if (search.filter === "reviewed") {
      return list.not("reviewed_at", "is", null).order("reviewed_at", { ascending: false }).order("id")
    }
    return list.is("reviewed_at", null).order("received_at", { ascending: true }).order("id")
  }

  const from = (page - 1) * RE_APPLICATIONS_PER_PAGE
  let { data, count, error } = await build()
    .range(from, from + RE_APPLICATIONS_PER_PAGE - 1)
    .overrideTypes<Row[], { merge: false }>()
  // PostgREST refuses a range past the last row. That page is empty, and a
  // count alone still says how many pages there are.
  if (error?.code === "PGRST103") {
    ;({ count, error } = await build(true))
    data = []
  }
  if (error) {
    console.error("Could not list re-applications", error)
    return { ok: false, error: "unavailable" }
  }

  const rows = data ?? []
  const names = await reviewers(supabase, rows)
  if (!names.ok) return names

  const total = count ?? 0
  return {
    ok: true,
    data: {
      reApplications: rows.map((row) => toSummary(row, names.data)),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / RE_APPLICATIONS_PER_PAGE)),
    },
  }
}

// How many re-applications wait for review. Zero for staff without
// leads.view, who can't read them.
export async function countUnreviewedReApplications(supabase: SupabaseClient): Promise<Result<number, "unavailable">> {
  const { count, error } = await supabase
    .from("re_applications")
    .select("id", { count: "exact", head: true })
    .is("reviewed_at", null)
  if (error) {
    console.error("Could not count the unreviewed re-applications", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: count ?? 0 }
}

// Every re-application on a lead, newest first, reviewed or not.
export async function getLeadReApplications(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<ReApplicationSummary[], "unavailable">> {
  const { data, error } = await supabase
    .from("re_applications")
    .select(COLUMNS)
    .eq("lead_id", leadId)
    .order("received_at", { ascending: false })
    .order("id")
    .overrideTypes<Row[], { merge: false }>()
  if (error) {
    console.error("Could not read a lead's re-applications", error)
    return { ok: false, error: "unavailable" }
  }
  const rows = data ?? []
  const names = await reviewers(supabase, rows)
  if (!names.ok) return names
  return { ok: true, data: rows.map((row) => toSummary(row, names.data)) }
}

// One re-application, with what the family sent.
export async function getReApplication(
  supabase: SupabaseClient,
  id: string,
): Promise<Result<ReApplication, "not-found" | "unavailable">> {
  const { data, error } = await supabase
    .from("re_applications")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<DetailRow, { merge: false }>()
  // A malformed id is no re-application at all.
  if (error?.code === "22P02") return { ok: false, error: "not-found" }
  if (error) {
    console.error("Could not read a re-application", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: false, error: "not-found" }

  const names = await reviewers(supabase, [data])
  if (!names.ok) return names
  return {
    ok: true,
    data: {
      ...toSummary(data, names.data),
      submitted: {
        contactName: data.contact_name,
        relationship: data.relationship,
        relationshipDescription: data.relationship_description,
        phone: data.phone,
        phoneAsSent: data.phone_as_sent,
        whatsapp: data.whatsapp,
        whatsappAsSent: data.whatsapp_as_sent,
        studentName: data.student_name,
        className: data.class_name,
        enrollmentYear: data.enrollment_year,
        dayOrBoarding: data.day_or_boarding,
      },
    },
  }
}

// Marks a re-application reviewed by the signed-in staff member, now. Needs
// leads.edit, and works on a closed lead too. Once only: a second mark is
// refused as `no-change`.
export async function markReApplicationReviewed(
  supabase: SupabaseClient,
  id: string,
): Promise<Result<null, MarkReviewedError>> {
  const { error } = await supabase.rpc("mark_re_application_reviewed", { re_application_id: id })
  if (error) {
    // Refused by the function, or by the grant for visitors not signed in.
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    if (error.message === "no_change") return { ok: false, error: "no-change" }
    console.error("Could not mark a re-application reviewed", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: null }
}
