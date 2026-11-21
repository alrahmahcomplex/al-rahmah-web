// The name rule from prototype v38 (#400). Every name is typed in parts, all
// required, stored in capitals. The database builds the stored names
// (registration_name and registration_person_name); these give the same
// result, for a page to show and compare names before it sends them.

// The student's own name and the father's three names.
export type StudentNameParts = {
  firstName: string
  fatherFirst: string
  fatherMiddle: string
  fatherLast: string
}

// A person's three names: the custodian, or anyone else named in full.
export type PersonNameParts = {
  firstName: string
  middleName: string
  lastName: string
}

// Which of the father's names is the student's last name (#511, prototype
// v50): his last name, unless the family uses his middle name. Stored on the
// lead as last_name_from.
export const LAST_NAME_FROM = ["father_last", "father_middle"] as const
export type LastNameFrom = (typeof LAST_NAME_FROM)[number]

// A part as stored: trimmed, inner whitespace one space, in capitals.
export function namePart(part: string): string {
  return part.trim().replace(/\s+/g, " ").toUpperCase()
}

// The student's full name: the student's name, the father's first name and
// the father's last name, or his middle name when the family uses it.
export function studentFullName(parts: StudentNameParts, from: LastNameFrom = "father_last"): string {
  return [parts.firstName, parts.fatherFirst, from === "father_middle" ? parts.fatherMiddle : parts.fatherLast].map(namePart).join(" ")
}

// The father's full name: all three of his names.
export function fatherFullName(parts: StudentNameParts): string {
  return [parts.fatherFirst, parts.fatherMiddle, parts.fatherLast].map(namePart).join(" ")
}

export function personFullName(parts: PersonNameParts): string {
  return [parts.firstName, parts.middleName, parts.lastName].map(namePart).join(" ")
}
