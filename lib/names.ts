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

// A part as stored: trimmed, inner whitespace one space, in capitals.
export function namePart(part: string): string {
  return part.trim().replace(/\s+/g, " ").toUpperCase()
}

// The student's full name: the student's name, the father's first name and
// the father's last name. The father's middle name is left out.
export function studentFullName(parts: StudentNameParts): string {
  return [parts.firstName, parts.fatherFirst, parts.fatherLast].map(namePart).join(" ")
}

// The father's full name: all three of his names.
export function fatherFullName(parts: StudentNameParts): string {
  return [parts.fatherFirst, parts.fatherMiddle, parts.fatherLast].map(namePart).join(" ")
}

export function personFullName(parts: PersonNameParts): string {
  return [parts.firstName, parts.middleName, parts.lastName].map(namePart).join(" ")
}
