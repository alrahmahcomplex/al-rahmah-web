"use server"

import { completeAdmissionVisit, MAX_STUDENTS_PER_FORM, type CheckInStudent, type RegistrationInvalidField, type RegistrationPerson, type RegistrationQuestion } from "@/lib/services/leads"
import { explainSiblingGroup } from "@/lib/services/sibling-counts"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { isPerson, isStudent, str, UUID } from "../new/shapes"
import { mayCheckIn } from "../permissions"

// Check-in of an Admission form family (#309): one save records the visit
// for every child on the form, or for none. The shapes are checked here; the
// database checks every rule and permission again.

export type CompleteVisitForm = {
  visitDate: string
  people: RegistrationPerson[]
  students: CheckInStudent[]
}

export type CompleteVisitOutcome =
  | {
      status: "completed"
      students: { student: number; leadId: string; admissionNumber: string }[]
      // How many of the children hold the Sibling 10%, and how many wait on a Sibling request.
      ten: number
      requests: number
    }
  | { status: "questions"; questions: RegistrationQuestion[] }
  | { status: "duplicate"; duplicates: { student: number; admissionNumber: string; leadId: string }[] }
  | { status: "refused"; field: RegistrationInvalidField | "lead_id" | null; student?: number; person?: number; reason?: string }
  | { status: "closed"; student?: number }
  // A child's visit was recorded while staff were answering.
  | { status: "not-applied"; student?: number }
  | { status: "forbidden" }
  | { status: "unavailable" }

const FAMILY_GAVE = ["className", "enrollmentYear", "dayOrBoarding"]

function isCheckInStudent(s: CheckInStudent, people: number, students: number): boolean {
  if (typeof s !== "object" || s === null || !str(s.leadId) || !UUID.test(s.leadId)) return false
  // The class, year and Day or Boarding stay as the family gave them.
  if (FAMILY_GAVE.some((k) => k in s)) return false
  return isStudent({ ...s, className: "KG 1", enrollmentYear: 0, dayOrBoarding: "Day" }, people, students)
}

/** Records the visit and saves the answers, every child or none. Questions come back before anything is saved. */
export async function completeVisit(form: CompleteVisitForm): Promise<CompleteVisitOutcome> {
  const { visitDate, people, students } = form ?? {}
  if (
    !str(visitDate) || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate) ||
    !Array.isArray(people) || !Array.isArray(students) ||
    students.length < 1 || students.length > MAX_STUDENTS_PER_FORM || people.length < 1 || people.length > students.length ||
    !people.every(isPerson) || !students.every((s) => isCheckInStudent(s, people.length, students.length))
  ) {
    return { status: "refused", field: null }
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "visits.record")
  if (!allowed.ok) return { status: allowed.error === "forbidden" ? "forbidden" : "unavailable" }
  if (!mayCheckIn(allowed.data.permissions)) return { status: "forbidden" }

  const result = await completeAdmissionVisit(supabase, { visitDate, people, students })
  if (!result.ok) {
    const e = result.error
    switch (e.kind) {
      case "duplicate":
        return { status: "duplicate", duplicates: e.duplicates.map((d) => ({ student: d.student, admissionNumber: d.admissionNumber, leadId: d.id })) }
      case "invalid":
        return { status: "refused", field: e.field, student: e.student, person: e.person, reason: e.reason }
      case "lead-closed":
        return { status: "closed", student: e.student }
      case "not-applied":
        return { status: "not-applied", student: e.student }
      case "forbidden":
        return { status: "forbidden" }
      default:
        return { status: "unavailable" }
    }
  }
  if (result.data.kind === "questions") return { status: "questions", questions: result.data.questions }

  const saved = result.data.students
  // The 10% the database gave, read once per group. A group that can't be read counts nothing rather than guessing.
  const ids = new Set(saved.map((s) => s.leadId))
  const seen = new Set<string>()
  let ten = 0
  for (const s of saved) {
    if (!s.sibling || seen.has(s.sibling.groupId)) continue
    seen.add(s.sibling.groupId)
    const explained = await explainSiblingGroup(supabase, s.leadId)
    if (explained.ok) ten += explained.data.members.filter((m) => ids.has(m.leadId) && m.result === "ten").length
  }
  const requests = saved.filter((s) => s.sibling?.basis === "request_needed").length

  return {
    status: "completed",
    students: saved.map((s) => ({ student: s.student, leadId: s.leadId, admissionNumber: s.admissionNumber })),
    ten,
    requests,
  }
}
