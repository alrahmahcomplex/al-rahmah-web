import { LAST_NAME_FROM } from "@/lib/names"
import {
  DAY_OR_BOARDING,
  LEAD_CLASSES,
  RELATIONSHIPS,
  STUDENT_GENDERS,
  type RegistrationPerson,
  type RegistrationStudent,
} from "@/lib/services/leads"

// The shapes the Register students and check-in actions take (#308, #309).
// Server Actions take input from anyone who can post to them, so each shape
// is checked; the database then checks every rule and permission again.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max
export const optStr = (v: unknown, max = 200) => v === undefined || v === null || str(v, max)
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
export const whole = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi

export function isPerson(p: RegistrationPerson): boolean {
  if (!isObject(p)) return false
  if ("contactId" in p) {
    return str(p.contactId) && UUID.test(p.contactId) && (p.alsoCheckPhones === undefined || (Array.isArray(p.alsoCheckPhones) && p.alsoCheckPhones.length <= 2 && p.alsoCheckPhones.every((x) => str(x, 40))))
  }
  return str(p.phone, 40) && optStr(p.whatsapp, 40) && optStr(p.firstName) && optStr(p.middleName) && optStr(p.lastName)
}

export function isStudent(s: RegistrationStudent, people: number, students: number): boolean {
  if (!isObject(s)) return false
  const c = s.custodian
  if (!isObject(c)) return false
  if ([s.previousSchool, s.siblingOf, s.nameAnswer, s.broughtBy].some((v) => v !== undefined && !isObject(v))) return false
  const custodian =
    whole(c.person, 1, people) && ("father" in c ? c.father === true : (RELATIONSHIPS as readonly string[]).includes(c.relationship) && optStr(c.relationshipDescription, 60))
  const school =
    s.previousSchool === undefined ||
    ("notKnown" in s.previousSchool ? s.previousSchool.notKnown === true : str(s.previousSchool.name) && ["private", "public"].includes(s.previousSchool.type) && str(s.previousSchool.region, 60) && optStr(s.previousSchool.country, 60))
  const sibling =
    s.siblingOf === undefined ||
    ("student" in s.siblingOf ? whole(s.siblingOf.student, 1, students) : str(s.siblingOf.leadId) && UUID.test(s.siblingOf.leadId))
  const answer = s.nameAnswer === undefined || (s.nameAnswer.answer === "typo" ? str(s.nameAnswer.spelling) : s.nameAnswer.answer === "different")
  const brought = s.broughtBy === undefined || (str(s.broughtBy.name, 120) && optStr(s.broughtBy.phone, 40) && optStr(s.broughtBy.relationship, 60))
  return (
    str(s.firstName) && str(s.fatherFirst) && str(s.fatherMiddle) && str(s.fatherLast) &&
    (s.lastNameFrom === undefined || (LAST_NAME_FROM as readonly string[]).includes(s.lastNameFrom)) &&
    (STUDENT_GENDERS as readonly string[]).includes(s.gender ?? "") &&
    (LEAD_CLASSES as readonly string[]).includes(s.className) &&
    Number.isInteger(s.enrollmentYear) &&
    (DAY_OR_BOARDING as readonly string[]).includes(s.dayOrBoarding) &&
    custodian && school && sibling && answer && brought &&
    (s.notASibling === undefined || typeof s.notASibling === "boolean") &&
    optStr(s.siblingFatherFullName) && optStr(s.requestNote, 1000) && (s.requestId === undefined || (str(s.requestId) && UUID.test(s.requestId)))
  )
}

