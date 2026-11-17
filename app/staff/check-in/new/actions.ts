"use server"

import { getLeadFee } from "@/lib/services/lead-fees"
import {
  DAY_OR_BOARDING,
  findFamilyByPhone,
  getFathersOfLeads,
  LEAD_CLASSES,
  MAX_STUDENTS_PER_FORM,
  RELATIONSHIPS,
  registerStudents,
  type RegistrationInvalidField,
  type RegistrationPerson,
  type RegistrationQuestion,
  type RegistrationStudent,
} from "@/lib/services/leads"
import { setLeadReferralCode } from "@/lib/services/referral"
import { explainSiblingGroup } from "@/lib/services/sibling-counts"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import type { KnownContact, OnFileFee } from "./model"
import { mayRegister } from "./permissions"

// Register students (#308): the form's three calls. Server Actions take input
// from anyone who can post to them, so each shape is checked here; the
// database then checks every rule and permission again.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max
const optStr = (v: unknown, max = 200) => v === undefined || v === null || str(v, max)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const whole = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi

function isPerson(p: RegistrationPerson): boolean {
  if (!isObject(p)) return false
  if ("contactId" in p) {
    return str(p.contactId) && UUID.test(p.contactId) && (p.alsoCheckPhones === undefined || (Array.isArray(p.alsoCheckPhones) && p.alsoCheckPhones.length <= 2 && p.alsoCheckPhones.every((x) => str(x, 40))))
  }
  return str(p.phone, 40) && optStr(p.whatsapp, 40) && optStr(p.firstName) && optStr(p.middleName) && optStr(p.lastName)
}

function isStudent(s: RegistrationStudent, people: number, students: number): boolean {
  if (!isObject(s)) return false
  const c = s.custodian
  if (!isObject(c)) return false
  if ([s.previousSchool, s.siblingOf, s.nameAnswer, s.broughtBy].some((v) => v !== undefined && !isObject(v))) return false
  const custodian =
    whole(c.person, 1, people) && ("father" in c ? c.father === true : (RELATIONSHIPS as readonly string[]).includes(c.relationship) && optStr(c.relationshipDescription, 60))
  const school =
    s.previousSchool === undefined ||
    ("notKnown" in s.previousSchool ? s.previousSchool.notKnown === true : str(s.previousSchool.name) && ["private", "public"].includes(s.previousSchool.type) && str(s.previousSchool.region, 60))
  const sibling =
    s.siblingOf === undefined ||
    ("student" in s.siblingOf ? whole(s.siblingOf.student, 1, students) : str(s.siblingOf.leadId) && UUID.test(s.siblingOf.leadId))
  const answer = s.nameAnswer === undefined || (s.nameAnswer.answer === "typo" ? str(s.nameAnswer.spelling) : s.nameAnswer.answer === "different")
  const brought = s.broughtBy === undefined || (str(s.broughtBy.name, 120) && optStr(s.broughtBy.phone, 40) && optStr(s.broughtBy.relationship, 60))
  return (
    str(s.firstName) && str(s.fatherFirst) && str(s.fatherMiddle) && str(s.fatherLast) &&
    (LEAD_CLASSES as readonly string[]).includes(s.className) &&
    Number.isInteger(s.enrollmentYear) &&
    (DAY_OR_BOARDING as readonly string[]).includes(s.dayOrBoarding) &&
    custodian && school && sibling && answer && brought &&
    (s.notASibling === undefined || typeof s.notASibling === "boolean") &&
    optStr(s.siblingFatherFullName) && optStr(s.requestNote, 1000) && (s.requestId === undefined || (str(s.requestId) && UUID.test(s.requestId)))
  )
}

export type RegisterFamilyForm = {
  visitDate: string
  people: RegistrationPerson[]
  students: RegistrationStudent[]
  // The family's Discount code, put on every student once they are saved. Null for none.
  code: string | null
}

export type RegisterFamilyOutcome =
  | {
      status: "created"
      students: { student: number; leadId: string; admissionNumber: string }[]
      // How many new students hold the Sibling 10%, and how many wait on a Sibling request.
      ten: number
      requests: number
      // Students the Discount code could not be put on.
      codeMissed: number
    }
  | { status: "questions"; questions: RegistrationQuestion[] }
  | { status: "duplicate"; duplicates: { student: number; admissionNumber: string; leadId: string }[] }
  | { status: "refused"; field: RegistrationInvalidField | null; student?: number; person?: number; reason?: string }
  | { status: "closed"; student?: number }
  | { status: "forbidden" }
  | { status: "unavailable" }

/** Saves the whole form, every student or none. Questions come back before anything is saved. */
export async function registerFamily(form: RegisterFamilyForm): Promise<RegisterFamilyOutcome> {
  const { visitDate, people, students, code } = form ?? {}
  if (
    !str(visitDate) || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate) ||
    !Array.isArray(people) || !Array.isArray(students) ||
    students.length < 1 || students.length > MAX_STUDENTS_PER_FORM || people.length < 1 || people.length > students.length ||
    !people.every(isPerson) || !students.every((s) => isStudent(s, people.length, students.length)) ||
    !(code === null || str(code, 60))
  ) {
    return { status: "refused", field: null }
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.create")
  if (!allowed.ok) return { status: allowed.error === "forbidden" ? "forbidden" : "unavailable" }
  // The page's rule holds here too: registering needs the fees as well (owner, 2026-11-17).
  if (!mayRegister(allowed.data.permissions)) return { status: "forbidden" }

  const result = await registerStudents(supabase, { visitDate, people, students })
  if (!result.ok) {
    const e = result.error
    switch (e.kind) {
      case "duplicate":
        return { status: "duplicate", duplicates: e.duplicates.map((d) => ({ student: d.student, admissionNumber: d.admissionNumber, leadId: d.id })) }
      case "invalid":
        return { status: "refused", field: e.field, student: e.student, person: e.person, reason: e.reason }
      case "lead-closed":
        return { status: "closed", student: e.student }
      case "forbidden":
        return { status: "forbidden" }
      default:
        return { status: "unavailable" }
    }
  }
  if (result.data.kind === "questions") return { status: "questions", questions: result.data.questions }

  const saved = result.data.students
  let codeMissed = 0
  if (code && code.trim()) {
    for (const s of saved) {
      try {
        const put = await setLeadReferralCode(supabase, s.leadId, code)
        if (!put.ok) {
          codeMissed++
          console.error("A new student's Discount code was not saved", put.error)
        }
      } catch (error) {
        codeMissed++
        console.error("A new student's Discount code was not saved", error)
      }
    }
  }

  // The 10% the database gave, read once per group. A group that can't be
  // read counts nothing rather than guessing.
  const newIds = new Set(saved.map((s) => s.leadId))
  const seen = new Set<string>()
  let ten = 0
  for (const s of saved) {
    if (!s.sibling || seen.has(s.sibling.groupId)) continue
    seen.add(s.sibling.groupId)
    const explained = await explainSiblingGroup(supabase, s.leadId)
    if (explained.ok) ten += explained.data.members.filter((m) => newIds.has(m.leadId) && m.result === "ten").length
  }
  const requests = saved.filter((s) => s.sibling?.basis === "request_needed").length

  return {
    status: "created",
    students: saved.map((s) => ({ student: s.student, leadId: s.leadId, admissionNumber: s.admissionNumber })),
    ten,
    requests,
    codeMissed,
  }
}

export type CustodianFamilyOutcome =
  | { status: "found"; contacts: KnownContact[] }
  | { status: "none" }
  // A role without leads.view, or a number that can't be read: go on without the check.
  | { status: "skipped" }
  | { status: "unavailable" }

/** The people on file who hold this number, with their children and each child's father's name. */
export async function findCustodianFamily(phone: string, whatsapp: string | null): Promise<CustodianFamilyOutcome> {
  if (!str(phone, 40) || !(whatsapp === null || str(whatsapp, 40))) return { status: "skipped" }
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.view")
  if (!allowed.ok) return { status: allowed.error === "forbidden" ? "skipped" : "unavailable" }

  const found = await findFamilyByPhone(supabase, { phone, whatsapp })
  if (!found.ok) return { status: found.error.kind === "unavailable" ? "unavailable" : "skipped" }
  // Only children on the contact itself: the save looks for siblings there.
  const contacts = found.data.contacts.map((c) => ({ ...c, children: c.children.filter((child) => !child.unconfirmed) }))
  if (contacts.length === 0) return { status: "none" }

  const fathers = await getFathersOfLeads(supabase, contacts.flatMap((c) => c.children.map((child) => child.id)))
  if (!fathers.ok) return { status: "unavailable" }
  return {
    status: "found",
    contacts: contacts.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      phone: c.phone,
      whatsapp: c.whatsapp,
      children: c.children.map((child) => ({
        id: child.id,
        admissionNumber: child.admissionNumber,
        studentName: child.studentName,
        className: child.className,
        status: child.status,
        closure: child.closure,
        fatherFullName: fathers.data[child.id] ?? null,
      })),
    })),
  }
}

/** A child on file staff linked a student to: its fee and who in its group gives the 10%, for the fee step. */
export async function readOnFileSibling(leadId: string): Promise<OnFileFee | null> {
  if (!str(leadId) || !UUID.test(leadId)) return null
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.view")
  if (!allowed.ok) return null

  const [explained, fee] = await Promise.all([explainSiblingGroup(supabase, leadId), getLeadFee(supabase, leadId)])
  if (!explained.ok) return null
  const members = explained.data.members
  const self = members.find((m) => m.leadId === leadId)
  if (!self) return null
  const name = (id: string | null) => members.find((m) => m.leadId === id)?.studentName ?? null
  const counting = (id: string | null) => {
    const m = members.find((x) => x.leadId === id)
    return !!m && m.leadOpen && m.status !== "Declined"
  }
  return {
    leadId,
    name: self.studentName,
    className: self.className,
    status: self.status,
    fee: fee.ok && fee.data.kind === "fee" ? fee.data.bandFee : null,
    pays: fee.ok && fee.data.kind === "fee" ? fee.data.schoolFee : null,
    anchorName: explained.data.anchors.length > 0 ? name(explained.data.anchors[0]) : self.status === "Enrolled" && self.result !== "ten" ? self.studentName : null,
    fullPayerName: counting(explained.data.fullPayerLeadId) ? name(explained.data.fullPayerLeadId) : null,
  }
}
