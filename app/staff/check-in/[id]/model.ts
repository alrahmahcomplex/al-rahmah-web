import type { PersonName } from "@/components/guided-form"
import type { AdmissionFormFamily, FormChild } from "@/lib/services/admission-form-family"
import type { CheckInStudent, RegistrationStudent, Relationship } from "@/lib/services/leads"

import { fatherNameMatch } from "@/lib/father-name"
import type { LastNameFrom } from "@/lib/names"

import {
  fatherName,
  NO_SCHOOL_ASKED,
  sameFatherEarlier,
  studentName as builtName,
  type Answers,
  type Custodian,
  type KnownContact,
  type RelationshipChoice,
  type Student,
  type StudentNameAnswer,
} from "../new/model"

// Check-in of an Admission form family (#309, prototype v38): the Register
// form's answers, started from what the form gave. Staff are asked only the
// rest (owner's rule 5); the class, year, Day or Boarding and the number of
// students stay as the family gave them.

/** What the form gave for one child, by the form's student key. */
export type GivenChild = {
  key: number
  leadId: string
  admissionNumber: string
  // The name parts the form's names split into, for the name question.
  prefill: StudentNameAnswer
  // Answered by the form: shown filled, "· from the Admission form".
  given: { name: boolean; gender: boolean }
  // Already in a sibling group: check-in keeps that link and asks nothing about it.
  linked: boolean
}

/** The form's parent, offered as the first custodian. Null when the children checked in sit on different contacts. */
export type GivenContact = { contact: KnownContact; relationship: Relationship; description: string | null }

export type CheckIn = {
  children: GivenChild[]
  contact: GivenContact | null
}

const words = (v: string | null | undefined) => (v ?? "").trim().toUpperCase().split(/\s+/).filter(Boolean)
const normal = (v: string) => words(v).join(" ")

/**
 * The four name parts from the stored names: the child's own name is the
 * first word of its name, the father's three from his full name (or, when the
 * lead holds none, the words after the first). Complete only when the father
 * has exactly three names and the student's name they make is the one stored,
 * so check-in changes no name staff haven't seen. The last-name choice the
 * lead holds (#511) says which of the father's names ends it; with none, his
 * last name.
 */
export function formName(studentName: string, fatherFullName: string | null, lastNameFrom: LastNameFrom | null = null): { name: StudentNameAnswer; complete: boolean } {
  const own = words(studentName)
  const father = fatherFullName ? words(fatherFullName) : own.slice(1)
  const name: StudentNameAnswer = {
    firstName: own[0] ?? "",
    fatherFirst: father[0] ?? "",
    fatherMiddle: father.length > 2 ? father.slice(1, -1).join(" ") : "",
    fatherLast: father.length > 1 ? father[father.length - 1] : "",
    lastNameFrom: lastNameFrom ?? "father_last",
  }
  const rebuilt = builtName(name)
  return { name, complete: father.length === 3 && !!name.firstName && rebuilt === normal(studentName) }
}

/** A person's one stored name in the three boxes: first, middle names, last. */
export function personParts(fullName: string): PersonName {
  const w = words(fullName)
  return { firstName: w[0] ?? "", middleName: w.length > 2 ? w.slice(1, -1).join(" ") : "", lastName: w.length > 1 ? w[w.length - 1] : "" }
}

/** The relationship the form gave, as the custodian question's choice. Father is the switch, not a choice. */
export function givenRelationship(c: GivenContact): { choice: RelationshipChoice; description: string } | null {
  if (c.relationship === "Mother" || c.relationship === "Guardian") return { choice: c.relationship, description: "" }
  if (c.relationship === "Other") return { choice: "Other", description: c.description ?? "" }
  return null
}

function student(child: FormChild, key: number): { student: Student; given: GivenChild } {
  const { name, complete } = formName(child.studentName, child.fatherFullName, child.lastNameFrom)
  const asksSchool = !NO_SCHOOL_ASKED.includes(child.className)
  return {
    student: {
      key,
      ...(complete ? { name } : {}),
      ...(child.gender ? { gender: child.gender } : {}),
      className: child.className,
      year: child.enrollmentYear,
      board: child.dayOrBoarding,
      ...(asksSchool && child.previousSchool ? { school: child.previousSchool } : {}),
    },
    given: { key, leadId: child.leadId, admissionNumber: child.admissionNumber, prefill: name, given: { name: complete, gender: !!child.gender }, linked: child.linked },
  }
}

/**
 * A person on file as check-in keeps them: without the children being checked
 * in. A child on file under a custodian is a "Sibling of" choice, and the
 * number looked up at check-in is often the family's own, so its children are
 * the ones on the form. None of them is its own sibling on file (the save
 * refuses that `sibling_of`), and two of them are siblings by the form's own
 * question, as the save reads them (complete_admission_visit leaves every lead
 * it checks in out of its same-father question). The person stays the same.
 */
const withoutCheckedIn = (contact: KnownContact, leadIds: ReadonlySet<string>): KnownContact =>
  contact.children.some((c) => leadIds.has(c.id)) ? { ...contact, children: contact.children.filter((c) => !leadIds.has(c.id)) } : contact

/** A custodian answer as check-in keeps it: a person on file comes without the children being checked in. */
export function custodianAtCheckIn(custodian: Custodian, checkIn: CheckIn): Custodian {
  if ((custodian.kind !== "father" && custodian.kind !== "known") || !custodian.contact) return custodian
  const contact = withoutCheckedIn(custodian.contact, new Set(checkIn.children.map((c) => c.leadId)))
  return contact === custodian.contact ? custodian : { ...custodian, contact }
}

/** The answers check-in starts from, and what the form gave. `children`: those still waiting for their visit. */
export function startCheckIn(family: AdmissionFormFamily, children: FormChild[]): { answers: Answers; checkIn: CheckIn } {
  const seeded = children.map((c, i) => student(c, i + 1))
  const students = seeded.map((s) => s.student)
  // Children already siblings in one group stay one household, with one custodian question: the later
  // one starts as "Sibling of" the first, which the save never sends (checkInStudents). Only while the
  // fathers' names are the same, as the form's own rule would have it; otherwise each is asked apart.
  for (const [i, child] of children.entries()) {
    const j = child.groupId ? children.findIndex((o, x) => x < i && o.groupId === child.groupId) : -1
    const mine = students[i]
    const theirs = students[j]
    if (j < 0 || !mine.name || !theirs?.name || fatherNameMatch(fatherName(mine.name), fatherName(theirs.name)) !== "same") continue
    students[i] = { ...mine, sibling: { kind: "match", of: theirs.key, seen: sameFatherEarlier(students, i) } }
  }
  // The parent is offered only when every child checked in sits on it. A child separated from the family
  // sits on a copy with the same name and number: offering one of the two would move a child from its
  // contact to the other with nothing on the screen saying so. Then the number is looked up as in
  // Register students, and staff say which person on file it is.
  const c = family.contact && children.every((child) => child.contactId === family.contact?.id) ? family.contact : null
  // The parent's children on file are the "Sibling of" choices: a form child whose visit is already
  // recorded is one of them, and a child checked in here never is.
  const checkedIn = new Set(children.map((child) => child.leadId))
  return {
    answers: { students, more: true, custodians: {}, onFileAsks: [], onFile: {} },
    checkIn: {
      children: seeded.map((s) => s.given),
      contact: c
        ? {
            contact: withoutCheckedIn(
              {
                id: c.id,
                fullName: c.fullName,
                phone: c.phone,
                whatsapp: c.whatsapp,
                children: family.onFile.map((f) => ({
                  id: f.leadId,
                  admissionNumber: f.admissionNumber,
                  studentName: f.studentName,
                  className: f.className,
                  status: f.status,
                  closure: f.closure,
                  fatherFullName: f.fatherFullName,
                })),
              },
              checkedIn,
            ),
            relationship: c.relationship,
            description: c.relationshipDescription,
          }
        : null,
    },
  }
}

/**
 * The Register form's payload as complete_admission_visit takes it: each
 * student with its lead. A child already in a sibling group keeps that link,
 * so it sends no sibling choice of its own.
 */
export function checkInStudents(students: RegistrationStudent[], answers: Answers, checkIn: CheckIn): CheckInStudent[] {
  return students.map((s, i) => {
    const given = checkIn.children.find((c) => c.key === answers.students[i]?.key)
    if (!given) throw new Error("A student on the check-in form has no lead")
    const out: CheckInStudent = {
      leadId: given.leadId,
      firstName: s.firstName,
      fatherFirst: s.fatherFirst,
      fatherMiddle: s.fatherMiddle,
      fatherLast: s.fatherLast,
      lastNameFrom: s.lastNameFrom,
      gender: s.gender,
      custodian: s.custodian,
      broughtBy: s.broughtBy,
      previousSchool: s.previousSchool,
      siblingOf: s.siblingOf,
      notASibling: s.notASibling,
      siblingFatherFullName: s.siblingFatherFullName,
      nameAnswer: s.nameAnswer,
      requestNote: s.requestNote,
      requestId: s.requestId,
    }
    for (const k of Object.keys(out) as (keyof CheckInStudent)[]) if (out[k] === undefined) delete out[k]
    if (given.linked) {
      delete out.siblingOf
      delete out.notASibling
      delete out.siblingFatherFullName
      delete out.nameAnswer
      delete out.requestNote
      delete out.requestId
    }
    return out
  })
}

/** "Hassan": the family's name in the page title, from the first child's last name. */
export function familyName(children: FormChild[]): string {
  const last = words(children[0]?.studentName).at(-1) ?? ""
  return last ? last[0] + last.slice(1).toLowerCase() : ""
}
