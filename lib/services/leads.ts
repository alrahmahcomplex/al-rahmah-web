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
  // An existing contact, optionally with the numbers staff typed for it at the
  // front desk: the duplicate check covers those as well as the stored ones.
  guardian: { contactId: string; alsoCheckPhones?: string[] } | { contact: NewContact }
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
    // Sent only when given, so every other call still matches the function
    // signature a database without this argument has.
    ...("contactId" in guardian && guardian.alsoCheckPhones ? { also_check_phones: guardian.alsoCheckPhones } : {}),
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
  // Kept for good once a reopening brings the lead back from Declined.
  initiallyDeclined: boolean
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
  initially_declined: boolean
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
      "id, admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, closure, visit_date, returning_family_joined, returning_family_reapplied, initially_declined, guardian_contacts!guardian_contact_id (id, full_name, relationship, relationship_description, phone, whatsapp)",
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
      initiallyDeclined: data.initially_declined,
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

export const LEAD_STATUSES = ["Applied", "Visited", "Interviewed", "Enrolled", "Declined"] as const satisfies readonly LeadStatus[]

// Which leads the list shows by closure mark: those without one (the default),
// one mark, or every lead.
export const CLOSURE_FILTERS = ["open", "Inactive", "Archived", "all"] as const
export type ClosureFilter = (typeof CLOSURE_FILTERS)[number]

export const LEADS_PER_PAGE = 50

export type LeadSearch = {
  query?: string
  status?: LeadStatus
  closure?: ClosureFilter
  // From 1.
  page: number
}

export type LeadListItem = {
  id: string
  admissionNumber: string
  studentName: string
  className: LeadClass
  enrollmentYear: number
  dayOrBoarding: DayOrBoarding
  status: LeadStatus
  closure: LeadClosure | null
  returningFamily: boolean
  initiallyDeclined: boolean
  createdAt: string
}

export type LeadSearchResults = {
  // What the query was read as: an Admission Number, part of a name, or
  // nothing, which lists leads under the filters.
  mode: "number" | "name" | "list"
  leads: LeadListItem[]
  total: number
  page: number
  pageCount: number
}

type LeadListRow = {
  id: string
  admission_number: string
  student_name: string
  class_name: LeadClass
  enrollment_year: number
  day_or_boarding: DayOrBoarding
  status: LeadStatus
  closure: LeadClosure | null
  returning_family_joined: boolean
  returning_family_reapplied: boolean
  initially_declined: boolean
  created_at: string
}

const LEAD_LIST_COLUMNS =
  "id, admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, closure, returning_family_joined, returning_family_reapplied, initially_declined, created_at"

// A page number past any real list. Larger ones would overflow the offset.
export const LAST_PAGE = 10_000

// Part of a name as the database keys names (lowercase, single spaces), as a
// regular expression that matches it anywhere in the key, every character
// taken literally. Not LIKE: PostgREST turns * into a wildcard there, with
// no way to escape it.
function namePattern(query: string) {
  const key = query.replace(/\s+/g, " ").toLowerCase()
  return key.replace(/[.*+?^${}()|[\]\\]/g, (character) => `\\${character}`)
}

// Finds leads for the Leads screen. A query that reads as an Admission Number
// finds that lead exactly, whatever its status or closure mark. Any other
// query matches part of the student's name, ignoring case and spacing, and
// lists leads without a closure mark first (Declined among them by name),
// then Inactive and Archived ones. With no query, the list shows leads under
// the filters, newest first; the filters apply only to this list. Row-level
// security shows nothing to anyone without leads.view.
export async function searchLeads(
  supabase: SupabaseClient,
  search: LeadSearch,
): Promise<Result<LeadSearchResults, "unavailable">> {
  const page = Number.isInteger(search.page) && search.page > 0 ? Math.min(search.page, LAST_PAGE) : 1
  const query = (search.query ?? "").trim()
  const admissionNumber = parseAdmissionNumber(query)
  const mode = !query ? "list" : admissionNumber ? "number" : "name"

  const build = (head = false) => {
    const select = supabase.from("leads").select(LEAD_LIST_COLUMNS, { count: "exact", head })
    if (mode === "number") return select.eq("admission_number", admissionNumber)
    if (mode === "name") {
      return select
        .filter("student_name_key", "imatch", namePattern(query))
        .order("closure", { ascending: true, nullsFirst: true })
        .order("student_name_key")
        .order("id")
    }
    let list = select
    const closure = search.closure ?? "open"
    if (closure === "open") list = list.is("closure", null)
    else if (closure !== "all") list = list.eq("closure", closure)
    if (search.status) list = list.eq("status", search.status)
    return list.order("created_at", { ascending: false }).order("id", { ascending: false })
  }

  const from = (page - 1) * LEADS_PER_PAGE
  const found = await build().range(from, from + LEADS_PER_PAGE - 1).overrideTypes<LeadListRow[], { merge: false }>()
  let { data, count, error } = found

  // PostgREST refuses a range past the last row. That page is empty, and a
  // count alone still says how many pages there are.
  if (error?.code === "PGRST103") {
    const counted = await build(true)
    ;({ count, error } = counted)
    data = []
  }
  if (error) {
    console.error("Could not search leads", error)
    return { ok: false, error: "unavailable" }
  }

  const total = count ?? 0
  return {
    ok: true,
    data: {
      mode,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / LEADS_PER_PAGE)),
      leads: (data ?? []).map((row) => ({
        id: row.id,
        admissionNumber: row.admission_number,
        studentName: row.student_name,
        className: row.class_name,
        enrollmentYear: row.enrollment_year,
        dayOrBoarding: row.day_or_boarding,
        status: row.status,
        closure: row.closure,
        returningFamily: row.returning_family_joined || row.returning_family_reapplied,
        initiallyDeclined: row.initially_declined,
        createdAt: row.created_at,
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// Corrections. Each is a database function that checks the permission
// itself and never touches the Admission Number or the status.
// ---------------------------------------------------------------------------

// The student's details a correction may change. A field left out keeps its
// value.
export type LeadDetailsChanges = Partial<NewStudent>

// The parent/guardian details a correction may change. A field left out keeps
// its value; an empty WhatsApp number means the same as the phone.
export type ContactChanges = Partial<Omit<NewContact, "relationshipDescription" | "whatsapp">> & {
  relationshipDescription?: string | null
  whatsapp?: string | null
}

export type CorrectionError =
  | { kind: "duplicate"; lead: ExistingLead }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  // Declined, Inactive and Archived leads are read-only, and so is a contact
  // whose children are all closed.
  | { kind: "closed" }
  // An Applied lead has no visit whose date could be corrected.
  | { kind: "not-visited" }
  // The children on a contact are no longer the ones the staff member saw.
  | { kind: "children-changed" }
  | { kind: "invalid"; field: InvalidField | null }
  | { kind: "unavailable" }

type CorrectionRow =
  | { result: "updated" }
  | { result: "duplicate"; lead_id: string; admission_number: string; status: LeadStatus; closure: LeadClosure | null }

type RpcAnswer = { data: unknown; error: { message: string; details?: string | null; code?: string } | null }

async function correction(call: PromiseLike<RpcAnswer>, what: string): Promise<Result<null, CorrectionError>> {
  const { data, error } = await call
  if (error) {
    if (error.message === "not_permitted") return { ok: false, error: { kind: "forbidden" } }
    // A malformed id is a missing lead, not an outage.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: { kind: "not-found" } }
    // `lead_closed` comes from assert_lead_open; `closed` from the checks on
    // every child on a contact.
    if (error.message === "closed" || error.message === "lead_closed") return { ok: false, error: { kind: "closed" } }
    if (error.message === "not_visited") return { ok: false, error: { kind: "not-visited" } }
    if (error.message === "children_changed") return { ok: false, error: { kind: "children-changed" } }
    if (error.message === "invalid") {
      return { ok: false, error: { kind: "invalid", field: invalidFieldOf(error.details) } }
    }
    console.error(`Could not ${what}`, error)
    return { ok: false, error: { kind: "unavailable" } }
  }

  const row = data as CorrectionRow | null
  if (row?.result === "duplicate") {
    return {
      ok: false,
      error: {
        kind: "duplicate",
        lead: { id: row.lead_id, admissionNumber: row.admission_number, status: row.status, closure: row.closure },
      },
    }
  }
  return { ok: true, data: null }
}

// The entries whose value was given, so a field left out stays out.
function given(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}

// Corrects the student's name, class, enrollment year or Day or boarding.
// Needs leads.edit. A new name that would match another lead under the
// duplicate rule is refused as `duplicate`, with that lead.
export async function updateLeadDetails(
  supabase: SupabaseClient,
  id: string,
  changes: LeadDetailsChanges,
): Promise<Result<null, CorrectionError>> {
  return correction(
    supabase.rpc("update_lead_details", {
      lead_id: id,
      changes: given({
        full_name: changes.fullName,
        class_name: changes.className,
        enrollment_year: changes.enrollmentYear,
        day_or_boarding: changes.dayOrBoarding,
      }),
    }),
    "correct a lead's details",
  )
}

// Corrects a parent/guardian contact, for every child on it. Needs
// leads.edit. Numbers are normalized as at creation, and a new number that
// would make any of those children match another lead is refused as
// `duplicate`, with that lead. A contact is refused as `closed` only when every
// child on it is closed: while an open child holds it, it stays editable for
// them all. With `expectedChildren`, the ids of the leads the staff member was
// told the change reaches, a contact whose children differ by then is refused
// as `children-changed`.
export async function updateGuardianContact(
  supabase: SupabaseClient,
  contactId: string,
  changes: ContactChanges,
  expectedChildren?: string[],
): Promise<Result<null, CorrectionError>> {
  return correction(
    supabase.rpc("update_guardian_contact", {
      contact_id: contactId,
      changes: given({
        full_name: changes.fullName,
        relationship: changes.relationship,
        relationship_description: changes.relationshipDescription,
        phone: changes.phone,
        whatsapp: changes.whatsapp,
      }),
      expected_lead_ids: expectedChildren ?? null,
    }),
    "correct a contact",
  )
}

// Corrects the Visit date of a lead that has one. Needs visits.record, and
// refuses a date later than today in Tanzania.
export async function correctVisitDate(
  supabase: SupabaseClient,
  id: string,
  visitDate: string,
): Promise<Result<null, CorrectionError>> {
  return correction(supabase.rpc("correct_visit_date", { lead_id: id, visited_on: visitDate }), "correct a Visit date")
}

export type ContactChild = {
  id: string
  admissionNumber: string
  studentName: string
  status: LeadStatus
  closure: LeadClosure | null
}

type ContactChildRow = {
  id: string
  admission_number: string
  student_name: string
  status: LeadStatus
  closure: LeadClosure | null
}

// Every lead on a contact, oldest first: the children a change to it reaches.
export async function listContactChildren(
  supabase: SupabaseClient,
  contactId: string,
): Promise<Result<ContactChild[], "unavailable">> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, admission_number, student_name, status, closure")
    .eq("guardian_contact_id", contactId)
    .order("created_at")
    .order("id")
    .overrideTypes<ContactChildRow[], { merge: false }>()

  if (error) {
    console.error("Could not list a contact's children", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: data.map((row) => ({
      id: row.id,
      admissionNumber: row.admission_number,
      studentName: row.student_name,
      status: row.status,
      closure: row.closure,
    })),
  }
}

// ---------------------------------------------------------------------------
// Recording the visit of an Applied family: a database function that checks
// the permission itself and moves a lead from Applied to Visited, and nothing
// else.
// ---------------------------------------------------------------------------

export type RecordVisitError =
  | { kind: "forbidden" }
  | { kind: "not-found" }
  // Only an Applied lead has a first visit still to record, so no lead goes
  // backwards and none records a second one.
  | { kind: "not-applied" }
  // An Applied lead marked Inactive or Archived is read-only.
  | { kind: "closed" }
  | { kind: "invalid"; field: InvalidField | null }
  | { kind: "unavailable" }

// Records that an Applied family came to campus on `visitDate`, which moves
// the lead to Visited. Needs visits.record, and refuses a date later than
// today in Tanzania.
export async function recordVisit(
  supabase: SupabaseClient,
  id: string,
  visitDate: string,
): Promise<Result<null, RecordVisitError>> {
  const { error } = await supabase.rpc("record_visit", { lead_id: id, visited_on: visitDate })
  if (!error) return { ok: true, data: null }

  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: { kind: "forbidden" } }
  // A malformed id is a missing lead, not an outage.
  if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: { kind: "not-found" } }
  if (error.message === "not_applied") return { ok: false, error: { kind: "not-applied" } }
  if (error.message === "lead_closed") return { ok: false, error: { kind: "closed" } }
  if (error.message === "invalid") return { ok: false, error: { kind: "invalid", field: invalidFieldOf(error.details) } }
  // 22007 and 22008: a date that isn't on the calendar, such as 31 February,
  // refused before the function runs.
  if (error.code === "22007" || error.code === "22008") return { ok: false, error: { kind: "invalid", field: "visit_date" } }
  console.error("Could not record a visit", error)
  return { ok: false, error: { kind: "unavailable" } }
}

// ---------------------------------------------------------------------------
// Matching a walk-in parent to a known Family. Phones only, never names.
// ---------------------------------------------------------------------------

export type FamilyChild = {
  id: string
  admissionNumber: string
  studentName: string
  className: LeadClass
  enrollmentYear: number
  status: LeadStatus
  closure: LeadClosure | null
  // On a contact the Admission form matched to this Family, which staff have
  // not yet confirmed.
  unconfirmed: boolean
}

export type FamilyContact = {
  id: string
  fullName: string
  relationship: Relationship
  relationshipDescription: string | null
  phone: string
  whatsapp: string | null
  // Every lead on this contact, oldest first, then, marked unconfirmed, the
  // leads the Admission form matched to it that staff have not yet confirmed.
  children: FamilyChild[]
}

export type FamilyMatch = {
  // The numbers as given, normalized the way contacts store them. A WhatsApp
  // number equal to the phone reads as none.
  phone: string
  whatsapp: string | null
  // Oldest first. Empty when nobody holds either number.
  contacts: FamilyContact[]
}

export type FindFamilyError =
  | { kind: "forbidden" }
  | { kind: "invalid"; field: "phone" | "whatsapp" | null }
  | { kind: "unavailable" }

type FamilyMatchRow = {
  phone: string
  whatsapp: string | null
  contacts: {
    id: string
    full_name: string
    relationship: Relationship
    relationship_description: string | null
    phone: string
    whatsapp: string | null
    children: FamilyChildRow[]
  }[]
}

type FamilyChildRow = {
  id: string
  admission_number: string
  student_name: string
  class_name: LeadClass
  enrollment_year: number
  status: LeadStatus
  closure: LeadClosure | null
  contact_id: string
  unconfirmed: boolean
}

function familyChild(row: FamilyChildRow): FamilyChild {
  return {
    id: row.id,
    admissionNumber: row.admission_number,
    studentName: row.student_name,
    className: row.class_name,
    enrollmentYear: row.enrollment_year,
    status: row.status,
    closure: row.closure,
    unconfirmed: row.unconfirmed,
  }
}

// Every contact whose direct or WhatsApp number equals either given number,
// once both are normalized, each with its Family's children. Needs
// leads.view. A number that is not a phone number is refused as `invalid`,
// naming the field.
export async function findFamilyByPhone(
  supabase: SupabaseClient,
  numbers: { phone: string; whatsapp?: string | null },
): Promise<Result<FamilyMatch, FindFamilyError>> {
  const { data, error } = await supabase.rpc("find_family_by_phone", {
    phone: numbers.phone,
    whatsapp: numbers.whatsapp ?? null,
  })

  if (error) {
    if (error.message === "not_permitted") return { ok: false, error: { kind: "forbidden" } }
    if (error.message === "invalid") {
      const field = invalidFieldOf(error.details)
      return { ok: false, error: { kind: "invalid", field: field === "phone" || field === "whatsapp" ? field : null } }
    }
    console.error("Could not look for a Family by phone", error)
    return { ok: false, error: { kind: "unavailable" } }
  }

  const row = data as FamilyMatchRow
  return {
    ok: true,
    data: {
      phone: row.phone,
      whatsapp: row.whatsapp,
      contacts: row.contacts.map((contact) => ({
        id: contact.id,
        fullName: contact.full_name,
        relationship: contact.relationship,
        relationshipDescription: contact.relationship_description,
        phone: contact.phone,
        whatsapp: contact.whatsapp,
        children: contact.children.map(familyChild),
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// The Family link on the lead screen: which Family a lead belongs to, and
// settling an unconfirmed match the Admission form left. Each write is a
// database function that checks leads.edit itself.
// ---------------------------------------------------------------------------

export type LeadFamilyChild = FamilyChild & {
  // Whether the child is on the same contact as the lead: a brother or sister
  // a change to that contact reaches, and who moves with the lead when its
  // match is confirmed.
  onLeadContact: boolean
}

export type LeadFamily = {
  // The contact the Admission form matched this lead's parent to, which staff
  // have not yet confirmed, or null when there is nothing to settle.
  pendingMatch: Omit<FamilyContact, "children"> | null
  // The Family's children, the lead included: those on the Family's contact,
  // oldest first, then those still unconfirmed. With a pending match, the
  // Family is the matched one, and the lead is among the unconfirmed.
  children: LeadFamilyChild[]
}

type LeadFamilyRow = {
  contact_id: string
  pending_match: {
    id: string
    full_name: string
    relationship: Relationship
    relationship_description: string | null
    phone: string
    whatsapp: string | null
  } | null
  children: FamilyChildRow[]
}

// The Family a lead belongs to, for anyone who may view leads.
export async function getLeadFamily(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadFamily, "not-found" | "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("lead_family", { lead_id: leadId })
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    // A malformed id is a missing lead, not an outage.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not read a lead's Family", error)
    return { ok: false, error: "unavailable" }
  }

  const row = data as LeadFamilyRow
  const matched = row.pending_match
  return {
    ok: true,
    data: {
      pendingMatch: matched && {
        id: matched.id,
        fullName: matched.full_name,
        relationship: matched.relationship,
        relationshipDescription: matched.relationship_description,
        phone: matched.phone,
        whatsapp: matched.whatsapp,
      },
      children: row.children.map((child) => ({
        ...familyChild(child),
        onLeadContact: child.contact_id === row.contact_id,
      })),
    },
  }
}

export type FamilyLinkError =
  | CorrectionError
  // The lead's contact has no unconfirmed match to confirm or reject.
  | { kind: "no-pending-match" }
  // The lead is alone on its contact, so there is no Family to leave.
  | { kind: "not-shared" }

async function familyLink(call: PromiseLike<RpcAnswer>, what: string): Promise<Result<null, FamilyLinkError>> {
  const answer = await call
  const code = answer.error?.message
  if (code === "no_pending_match") return { ok: false, error: { kind: "no-pending-match" } }
  if (code === "not_shared") return { ok: false, error: { kind: "not-shared" } }
  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (answer.error?.code === "42501") return { ok: false, error: { kind: "forbidden" } }
  return correction(Promise.resolve(answer), what)
}

// Confirms that the parent the Admission form matched is the same person.
// Every child on the lead's contact moves into the matched Family. Needs
// leads.edit. With `expectedChildren`, the ids of the leads the staff member
// was told move, a contact whose children differ by then is refused as
// `children-changed`. A child who would then match another lead under the
// duplicate rule is refused as `duplicate`, with that lead.
export async function confirmFamilyMatch(
  supabase: SupabaseClient,
  leadId: string,
  expectedChildren?: string[],
): Promise<Result<null, FamilyLinkError>> {
  return familyLink(
    supabase.rpc("confirm_family_match", { lead_id: leadId, expected_lead_ids: expectedChildren ?? null }),
    "confirm a Family match",
  )
}

// Rejects the match: the parent is someone else. The match is cleared for
// every child on the lead's contact, and so is their Family cause of the
// Returning family badge. Needs leads.edit; `expectedChildren` as for
// confirming.
export async function rejectFamilyMatch(
  supabase: SupabaseClient,
  leadId: string,
  expectedChildren?: string[],
): Promise<Result<null, FamilyLinkError>> {
  return familyLink(
    supabase.rpc("reject_family_match", { lead_id: leadId, expected_lead_ids: expectedChildren ?? null }),
    "reject a Family match",
  )
}

// Separates a lead from the Family it shares a contact with: it gets its own
// copy of the contact and loses the Family cause of the Returning family
// badge. Needs leads.edit.
export async function separateFromFamily(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<null, FamilyLinkError>> {
  return familyLink(supabase.rpc("separate_from_family", { lead_id: leadId }), "separate a lead from its Family")
}
