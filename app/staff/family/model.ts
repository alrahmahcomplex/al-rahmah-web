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

export type NameParts = { firstName: string; fatherFirst: string; fatherMiddle: string; fatherLast: string }

/**
 * The name boxes for a stored student and father: the student's own name and
 * the father's three. The student's name ends with the father's first name
 * and his last name, so the father's last name is the longest run of his
 * last words that the student's name ends with, after his first name. That
 * keeps a last name of two words ("DE SOUZA") whole. A name not built that
 * way gives its first word, and the father's first word, middle words and
 * last word.
 */
export function nameParts(studentName: string, fatherFullName: string | null): NameParts {
  const name = words(studentName)
  const father = words(fatherFullName)
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((word, i) => word.toLowerCase() === b[i].toLowerCase())
  // k: how many of the father's last words are his last name. At least one word stays for his middle name when he has three or more.
  for (let k = Math.max(1, father.length - 2); k >= 1 && father.length >= 2; k--) {
    const tail = [father[0], ...father.slice(-k)]
    if (name.length > tail.length && same(name.slice(-tail.length), tail)) {
      return { firstName: name.slice(0, -tail.length).join(" "), fatherFirst: father[0], fatherMiddle: father.slice(1, -k).join(" "), fatherLast: father.slice(-k).join(" ") }
    }
  }
  return {
    firstName: name[0] ?? "",
    fatherFirst: father[0] ?? "",
    fatherMiddle: father.length > 2 ? father.slice(1, -1).join(" ") : "",
    fatherLast: father.length > 1 ? father[father.length - 1] : "",
  }
}

/** Groups students by the custodian they sit on, in the order the students come. */
export function byCustodian<S extends { contactId: string }>(students: readonly S[]): { contactId: string; members: S[] }[] {
  const groups = new Map<string, S[]>()
  for (const s of students) groups.set(s.contactId, [...(groups.get(s.contactId) ?? []), s])
  return [...groups].map(([contactId, members]) => ({ contactId, members }))
}
