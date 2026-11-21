import { MAX_STUDENTS_PER_FORM } from "@/lib/services/leads"
import { list } from "@/lib/sibling-sentences"

// The Family page (#512): the students one Register students or Check-in save
// made or completed, by their lead ids in the address,
// /staff/family?students=<id>,<id>. Nothing in the database ties them
// together, so the page shows exactly the ids it is given.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const FAMILY_MIN = 2
export const FAMILY_MAX = MAX_STUDENTS_PER_FORM

/** The page's address for these students, in the order the form saved them. */
export const familyHref = (leadIds: readonly string[]) => `/staff/family?students=${leadIds.join(",")}`

/**
 * The lead ids in `?students=`, or null when the address doesn't name 2 to 8
 * different leads. The ids keep their order: the form's order.
 */
export function parseFamilyIds(param: string | string[] | undefined): string[] | null {
  if (typeof param !== "string") return null
  const ids = param.split(",").map((id) => id.trim().toLowerCase())
  if (ids.length < FAMILY_MIN || ids.length > FAMILY_MAX) return null
  if (!ids.every((id) => UUID.test(id))) return null
  if (new Set(ids).size !== ids.length) return null
  return ids
}

const words = (name: string | null) => (name ?? "").trim().split(/\s+/).filter(Boolean)
// Names are stored in capitals; a title shows them as words.
const asWord = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

/**
 * "The Mrisho family" when every student's father has the same last name,
 * otherwise "The family of Neema, Hamisi and Zawadi" (owner, prototype v54).
 */
export function familyTitle(students: readonly { studentName: string; fatherFullName: string | null }[]): string {
  const lasts = new Set(students.map((s) => (words(s.fatherFullName).at(-1) ?? "").toLowerCase()))
  const [last] = lasts
  if (lasts.size === 1 && last) return `The ${asWord(last)} family`
  return `The family of ${list(students.map((s) => asWord(words(s.studentName)[0] ?? s.studentName)), "and")}`
}

/** A student's full name from its parts: the student's own name, then the father's first and last names (20261223100100). */
export function studentNameOf(first: string, fatherFirst: string, fatherLast: string): string {
  return [first, fatherFirst, fatherLast].map((part) => part.trim().replace(/\s+/g, " ").toUpperCase()).join(" ")
}

/**
 * The student's own name: the stored name less the father's first and last
 * names at its end, or its first word when the name was not built that way.
 */
export function ownName(studentName: string, fatherFullName: string | null): string {
  const name = words(studentName)
  const father = words(fatherFullName)
  const tail = father.length >= 2 ? [father[0], father[father.length - 1]] : []
  const ends =
    tail.length === 2 && name.length > 2 && name.slice(-2).every((word, i) => word.toLowerCase() === tail[i].toLowerCase())
  return ends ? name.slice(0, -2).join(" ") : (name[0] ?? "")
}

/** Groups students by the custodian they sit on, in the order the students come. */
export function byCustodian<S extends { contactId: string }>(students: readonly S[]): { contactId: string; members: S[] }[] {
  const groups = new Map<string, S[]>()
  for (const s of students) groups.set(s.contactId, [...(groups.get(s.contactId) ?? []), s])
  return [...groups].map(([contactId, members]) => ({ contactId, members }))
}
