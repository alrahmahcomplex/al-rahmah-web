import { childrenProblems, MAX_CHILDREN, parentProblems, type AdmissionChild, type AdmissionParent, type FieldProblem, type FormField } from "@/lib/admission-form"
import { namePart, personFullName, studentFullName, type PersonNameParts, type StudentNameParts } from "@/lib/names"
import { normalizeDiscountCode } from "@/lib/referral-link"
import { currentAdmissionYear } from "@/lib/school-calendar"

import type { ChildDraft, ParentDraft } from "./draft"

// The order of the Admission form's questions, one open at a time, and which
// answers each question owns. Pure, so the form and its tests share it.
//
// Per student: name (with the last-name choice), boy or girl, class (with the year), Day or Boarding. Then "another
// student?", unless the form already has MAX_CHILDREN. Then who the custodian
// is (The father, or Someone else and their name), the relationship (skipped
// for The father) and phone, the Discount code, the interview fee, and
// the send step. Student questions carry the card number, which stays with
// the card when another card is removed.

export type StudentKind = "name" | "gender" | "class" | "board"
export type StepKey = `${StudentKind}:${number}` | "more" | "pname" | "rel" | "phone" | "code" | "fee" | "send"

export const STUDENT_KINDS: readonly StudentKind[] = ["name", "gender", "class", "board"]

export function studentKey(kind: StudentKind, card: number): StepKey {
  return `${kind}:${card}`
}

export function parseKey(key: StepKey): { kind: StudentKind | Exclude<StepKey, `${StudentKind}:${number}`>; card: number | null } {
  const [kind, card] = key.split(":")
  return card === undefined ? { kind: kind as Exclude<StepKey, `${StudentKind}:${number}`>, card: null } : { kind: kind as StudentKind, card: Number(card) }
}

export function order(children: readonly ChildDraft[]): StepKey[] {
  const keys: StepKey[] = []
  for (const child of children) for (const kind of STUDENT_KINDS) keys.push(studentKey(kind, child.card))
  if (children.length < MAX_CHILDREN) keys.push("more")
  keys.push("pname", "rel", "phone", "code", "fee", "send")
  return keys
}

// The father whose names "The father" as custodian takes:
// the first student's, also when the form has several (lead, 2026-11-17).
export function switchFather(children: readonly ChildDraft[]): PersonNameParts {
  const first = children[0]
  return { firstName: first?.fatherFirst ?? "", middleName: first?.fatherMiddle ?? "", lastName: first?.fatherLast ?? "" }
}

function studentParts(draft: ChildDraft): StudentNameParts {
  return { firstName: draft.firstName, fatherFirst: draft.fatherFirst, fatherMiddle: draft.fatherMiddle, fatherLast: draft.fatherLast }
}

/** The student's full name as the database builds it: own name, father's first, then his last name or the middle one the family picked. */
export function studentName(draft: ChildDraft): string {
  const last = draft.lastNameFrom === "father_middle" ? draft.fatherMiddle : draft.fatherLast
  return [draft.firstName, draft.fatherFirst, last].map(namePart).filter(Boolean).join(" ")
}

/** Whether the custodian is the first student's father. */
export function fatherIsCustodian(parent: ParentDraft): boolean {
  return parent.custodian === "father"
}

/** The custodian's three names: the first student's father when he was picked. */
export function custodianParts(parent: ParentDraft, children: readonly ChildDraft[]): PersonNameParts {
  return fatherIsCustodian(parent) ? switchFather(children) : { firstName: parent.firstName, middleName: parent.middleName, lastName: parent.lastName }
}

export function custodianName(parent: ParentDraft, children: readonly ChildDraft[]): string {
  const { firstName, middleName, lastName } = custodianParts(parent, children)
  return [firstName, middleName, lastName].map(namePart).filter(Boolean).join(" ")
}

/** The father's three names, as "The father" shows them. */
export function fatherName(children: readonly ChildDraft[]): string {
  const { firstName, middleName, lastName } = switchFather(children)
  return [firstName, middleName, lastName].map(namePart).filter(Boolean).join(" ")
}

/** The relationship question is skipped while the father is the custodian: it is Father. */
export function skipped(key: StepKey, parent: ParentDraft): boolean {
  return key === "rel" && fatherIsCustodian(parent)
}

export function asParent(draft: ParentDraft, children: readonly ChildDraft[]): AdmissionParent {
  const nameParts = custodianParts(draft, children)
  const relationship = fatherIsCustodian(draft) ? "Father" : draft.relationship
  return {
    fullName: personFullName(nameParts),
    nameParts,
    relationship: relationship as AdmissionParent["relationship"],
    relationshipDescription: relationship === "Other" ? draft.relationshipDescription : undefined,
    phone: draft.phone,
    whatsapp: draft.whatsapp || undefined,
  }
}

export function asChild(draft: ChildDraft): AdmissionChild {
  return {
    fullName: studentFullName(studentParts(draft), draft.lastNameFrom),
    nameParts: studentParts(draft),
    lastNameFrom: draft.lastNameFrom,
    ...(draft.gender ? { gender: draft.gender as AdmissionChild["gender"] } : {}),
    className: draft.className as AdmissionChild["className"],
    enrollmentYear: draft.enrollmentYear ?? 0,
    dayOrBoarding: draft.dayOrBoarding as AdmissionChild["dayOrBoarding"],
  }
}

// What the page posts (the names contract on #400): names in their parts only,
// never `fullName`, which parseAdmissionForm refuses.
export function wireParent(draft: ParentDraft, children: readonly ChildDraft[]) {
  const { nameParts, relationship, relationshipDescription, phone, whatsapp } = asParent(draft, children)
  return { ...nameParts, relationship, relationshipDescription, phone, whatsapp }
}

export function wireChild(draft: ChildDraft) {
  const { nameParts, lastNameFrom, gender, className, enrollmentYear, dayOrBoarding } = asChild(draft)
  return { ...nameParts, lastNameFrom, gender, className, enrollmentYear, dayOrBoarding }
}

const STEP_FIELDS: Record<string, readonly FormField[]> = {
  name: ["student_name", "duplicate_child"],
  gender: ["gender"],
  class: ["class_name", "enrollment_year"],
  board: ["day_or_boarding"],
  pname: ["contact_name"],
  rel: ["relationship", "relationship_description"],
  phone: ["phone", "whatsapp"],
  code: ["discount_code"],
}

/** The question that holds a field: the card's own for a student's field. */
export function stepForProblem(problem: FieldProblem, children: readonly ChildDraft[]): StepKey | null {
  for (const [kind, fields] of Object.entries(STEP_FIELDS)) {
    if (!fields.includes(problem.field)) continue
    if ((STUDENT_KINDS as readonly string[]).includes(kind)) {
      const child = problem.child === null ? null : children[problem.child]
      return child ? studentKey(kind as StudentKind, child.card) : null
    }
    return kind as StepKey
  }
  return null
}

export type Entries = { parent: ParentDraft; children: readonly ChildDraft[]; discountCode: string }

/**
 * What stops a question from folding: the problems with the answers it owns.
 * A class question checks only the class: its year is always set when it
 * folds. The phone's format is the server's to judge.
 */
export function stepProblems(key: StepKey, { parent, children, discountCode }: Entries, years: readonly number[]): FieldProblem[] {
  const { kind, card } = parseKey(key)
  if (kind === "more" || kind === "fee" || kind === "send") return []
  if (kind === "code") {
    return discountCode.trim() && !normalizeDiscountCode(discountCode) ? [{ field: "discount_code", child: null }] : []
  }
  if (card !== null) {
    const index = children.findIndex((child) => child.card === card)
    if (index < 0) return []
    const fields = STEP_FIELDS[kind]
    return childrenProblems(children.map(asChild), years).filter(
      (problem) => problem.child === index && fields.includes(problem.field) && (kind !== "class" || problem.field === "class_name" || children[index].enrollmentYear !== null),
    )
  }
  // Who the custodian is comes first (#513): nobody picked is the custodian question's own problem, on no box.
  if (kind === "pname" && parent.custodian === "") return [{ field: "contact_name", child: null }]
  return parentProblems(asParent(parent, children)).filter((problem) => STEP_FIELDS[kind].includes(problem.field))
}

/** The first question not yet answered, or the send step. */
export function furthest(children: readonly ChildDraft[], done: ReadonlySet<StepKey>): StepKey {
  return order(children).find((key) => !done.has(key)) ?? "send"
}

/** The first question that is unanswered or no longer holds a good answer. */
export function firstOpenable(entries: Entries, done: ReadonlySet<StepKey>, years: readonly number[]): StepKey {
  return order(entries.children).find((key) => !done.has(key) || stepProblems(key, entries, years).length > 0) ?? "send"
}

/** The year a student joins: theirs once picked, else the student before's, else the coming intake. */
export function yearOf(children: readonly ChildDraft[], index: number, defaultYear: number): number {
  for (let i = index; i >= 0; i--) {
    const year = children[i]?.enrollmentYear
    if (year !== null && year !== undefined) return year
  }
  return defaultYear
}

/** The coming intake: the current admission year, in Tanzania time (clamped to `years`). */
export function defaultYear(years: readonly [number, number], tanzaniaDate: string): number {
  const admissionYear = currentAdmissionYear(tanzaniaDate)
  return years.includes(admissionYear) ? admissionYear : admissionYear < years[0] ? years[0] : years[1]
}

/** The student's own name, for the questions that name them. */
export function firstName(child: ChildDraft | undefined): string {
  return child ? namePart(child.firstName) : ""
}

// The URL and the draft name a question by the student's place on the form
// (`name-2`), since card numbers start afresh on a reload.

/** A student's question in the URL or the draft: `gender-2`. */
export const STUDENT_PARAM = /^(name|gender|class|board)-([1-8])$/

export function keyToParam(key: StepKey, children: readonly ChildDraft[]): string | null {
  const { kind, card } = parseKey(key)
  if (card === null) return kind
  const index = children.findIndex((child) => child.card === card)
  return index < 0 ? null : `${kind}-${index + 1}`
}

export function paramToKey(param: string | null, children: readonly ChildDraft[]): StepKey | null {
  if (!param) return null
  if (["more", "pname", "rel", "phone", "code", "fee", "send"].includes(param)) return param as StepKey
  const match = STUDENT_PARAM.exec(param)
  if (!match) return null
  const child = children[Number(match[2]) - 1]
  return child ? studentKey(match[1] as StudentKind, child.card) : null
}

/**
 * Which questions count as answered after a reload: those the draft named,
 * in order, up to the first that no longer holds a good answer.
 */
export function restoreDone(params: readonly string[], entries: Entries, years: readonly number[]): Set<StepKey> {
  const named = new Set(params.map((param) => paramToKey(param, entries.children)).filter((key): key is StepKey => key !== null))
  const done = new Set<StepKey>()
  for (const key of order(entries.children)) {
    if (key === "send" || !named.has(key) || stepProblems(key, entries, years).length > 0) break
    // A year the form no longer offers came back unpicked: the class question
    // shows a year it would not send, so it opens again.
    const { kind, card } = parseKey(key)
    if (kind === "class" && entries.children.find((child) => child.card === card)?.enrollmentYear === null) break
    done.add(key)
  }
  return done
}
