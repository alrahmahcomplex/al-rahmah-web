import type { FatherName, PersonName, StudentName } from "@/components/guided-form"
import { fatherNameMatch, normalizeFatherName, type FatherNameMatch } from "@/lib/father-name"
import { BAND_CLASSES, FEE_BANDS, type FeeBand } from "@/lib/services/fees"
import type {
  DayOrBoarding,
  LeadClass,
  LeadClosure,
  LeadStatus,
  RegistrationPerson,
  RegistrationStudent,
  Relationship,
} from "@/lib/services/leads"

// Register students (#308, prototype v38): the answers the form holds, and
// the plain rules it reads them by. No React here, so the rules are tested
// without a browser. The database decides every sibling link and fee on save;
// the fee step is the form's own preview of the rule (spec #296).

export const MOST_STUDENTS = 8
/** Asked from STD 2 (the ministry's PREMS register). */
export const NO_SCHOOL_ASKED: readonly LeadClass[] = ["DAY CARE", "KG 1", "KG 2", "STD 1"]
export const POPULAR_CLASS: LeadClass = "FORM 1"
export const CLASS_LEVELS: { label: string; classes: LeadClass[] }[] = [
  { label: "Nursery", classes: ["DAY CARE", "KG 1", "KG 2"] },
  { label: "Primary", classes: ["STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7"] },
  { label: "Secondary", classes: ["FORM 1", "FORM 2", "FORM 3", "FORM 4"] },
]
/** previous_school_regions() in the database, in the prototype's order: the busiest first. */
export const REGIONS = [
  "Dar es Salaam", "Pwani", "Morogoro", "Dodoma", "Arusha", "Mwanza", "Tanga", "Outside Tanzania", "Geita", "Iringa", "Kagera", "Katavi",
  "Kigoma", "Kilimanjaro", "Lindi", "Manyara", "Mara", "Mbeya", "Mtwara", "Njombe", "Rukwa", "Ruvuma", "Shinyanga", "Simiyu", "Singida",
  "Songwe", "Tabora", "Kaskazini Unguja", "Kusini Unguja", "Mjini Magharibi", "Kaskazini Pemba", "Kusini Pemba",
]

export type SchoolAnswer = { name: string; type: "private" | "public"; region: string } | { notKnown: true }

/**
 * The answer to "Is X a sibling of another student here?", naming the earlier
 * student by key. An answer holds only for the question staff saw:
 * `seen` lists the earlier students the question named as having the same
 * father's name, and `against` is the father's name this student's was
 * compared with. When either changes, linking() calls the answer stale and
 * it is asked again.
 */
export type SiblingAnswer =
  | { kind: "none"; seen?: number[] }
  | { kind: "match"; of: number; seen?: number[] }
  // Close names that staff called one name with a typing mistake: `spelling` is the right father's name.
  | { kind: "typo"; of: number; spelling: string; against: string; seen?: number[] }
  // A Sibling request for the Admissions Manager. `close`: the names were close and staff said two names.
  | { kind: "request"; of: number; note: string; requestId: string; close: boolean; against: string; seen?: number[] }

export type Student = {
  // Stays with the student when another is removed.
  key: number
  name?: StudentName
  className?: LeadClass
  // Left out: the student before's, else the coming intake.
  year?: number
  board?: DayOrBoarding
  school?: SchoolAnswer
  sibling?: SiblingAnswer
}

/** A child on file under a known contact, with the father's name it holds. */
export type OnFileChild = {
  id: string
  admissionNumber: string
  studentName: string
  className: LeadClass
  status: LeadStatus
  closure: LeadClosure | null
  fatherFullName: string | null
}

/** A person on file that staff said is the same person. */
export type KnownContact = { id: string; fullName: string; phone: string; whatsapp: string | null; children: OnFileChild[] }

/** First-time relationships, and those for the same person as before (prototype v38). */
export const FIRST_RELATIONSHIPS = ["Mother", "Guardian", "Other"] as const
export const SAME_RELATIONSHIPS = ["Aunt", "Uncle", "Grandparent", "Guardian", "Sibling", "Other"] as const
export type RelationshipChoice = (typeof FIRST_RELATIONSHIPS)[number] | (typeof SAME_RELATIONSHIPS)[number]

export type Custodian =
  // The father, by his phone; `contact` when staff said the number's owner on file is him.
  | { kind: "father"; phone: string; whatsapp: string; contact?: KnownContact }
  // The same person as the first household's custodian, with their own relationship to these children.
  | { kind: "same"; relationship: RelationshipChoice; description: string }
  | { kind: "known"; contact: KnownContact; phone: string; whatsapp: string; relationship: RelationshipChoice; description: string }
  | { kind: "new"; name: PersonName; phone: string; whatsapp: string; relationship: RelationshipChoice; description: string }

/** Who brought the students: one of the custodians, by their place in `people()`, or someone else. */
export type Brought = { who: "person"; person: number } | { who: "else"; name: string; phone: string; relationship: string }

/** A child on file with the same father's name as a household: the question, and its answer. */
export type OnFileAsk = { student: number; leadId: string; name: string; admissionNumber: string; father: string; fromSave?: boolean }

export type Answers = {
  students: Student[]
  more?: true
  // By the household's first student's key.
  custodians: Record<number, Custodian>
  // Questions the save raised about a child on file, kept until answered.
  onFileAsks: OnFileAsk[]
  // By the student's key: staff's answer about one child on file. Yes links to that child, and no other.
  onFile: Record<number, { leadId: string; yes: boolean }>
  brought?: Brought
  code?: string
  // The fee preview staff accepted, as feeSignature() writes it: a different preview asks again.
  feesChecked?: string
}

export const freshAnswers = (key: number): Answers => ({ students: [{ key }], custodians: {}, onFileAsks: [], onFile: {} })

export const isEmpty = (a: Answers) =>
  a.students.length === 1 && Object.keys(a.students[0]).length === 1 && !a.more && Object.keys(a.custodians).length === 0 && !a.brought && a.code === undefined

// ---------------------------------------------------------------------------
// Names.
// ---------------------------------------------------------------------------

const join = (...parts: (string | undefined)[]) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" ")

/** The student's full name: their own name with the father's first and last names (#400). */
export const studentName = (n?: StudentName) => (n ? join(n.firstName, n.fatherFirst, n.fatherLast) : "")
/** The father's full name: all three of his names. */
export const fatherName = (n?: StudentName) => (n ? join(n.fatherFirst, n.fatherMiddle, n.fatherLast) : "")
export const personName = (n: PersonName) => join(n.firstName, n.middleName, n.lastName)
export const firstOf = (name: string) => name.trim().split(/\s+/)[0] || "the student"
export const list = (a: string[]) => (a.length < 2 ? (a[0] ?? "") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`)
export const digits = (v: string) => v.replace(/\D/g, "")
export const phoneOk = (v: string) => digits(v).length >= 10
export const count = (n: number) => `${n} ${n === 1 ? "student" : "students"}`

// ---------------------------------------------------------------------------
// The sibling links, as the database makes them on save.
// ---------------------------------------------------------------------------

type Basis = "matched" | "typo_confirmed" | "request_needed"
/** sibling_basis_counts in the database. A student waiting on a Sibling request does not count. */
const counts = (basis: Basis | undefined) => basis === "matched" || basis === "typo_confirmed"
const sameName = (a: string | null | undefined, b: string | null | undefined) => fatherNameMatch(a, b) === "same"
const TIER_ORDER: Record<FatherNameMatch, number> = { same: 0, close: 1, different: 2 }

/** What a link to an earlier student compares, at the moment it is made. */
export type Compared = {
  // Which question staff get: same is a match, close asks "one name, or two?", different is a request.
  tier: FatherNameMatch
  // The counting student of that group this student is compared with, and its father's name then.
  with: number
  theirs: string
  // The earlier student's own father's name then.
  father: string
}

export type Linking = {
  // The father's name each record holds once every link is saved.
  fathers: Map<number, string>
  // By student, then by earlier student: what a link to that one compares.
  compared: Map<number, Map<number, Compared>>
  // Linked students only. A household's first student is matched.
  basis: Map<number, Basis>
  // The first student whose sibling answer is not for the question the form asks now.
  stale: number | null
}

function holds(sib: Exclude<SiblingAnswer, { kind: "none" }>, c: Compared, mine: string): boolean {
  if (sib.kind === "match") return c.tier === "same"
  if (!sameName(sib.against, c.theirs)) return false
  if (sib.kind === "typo") return c.tier === "close" && (sameName(sib.spelling, mine) || sameName(sib.spelling, c.theirs))
  return c.tier === (sib.close ? "close" : "different")
}

/**
 * The sibling links as register_students makes them: one student after
 * another in the form's order, so a student is linked after the one it links
 * to. Each link compares the student's father's name with the names its
 * sibling's group counts by at that moment (link_sibling_locked and
 * sibling_name_check): the best answer wins, the earlier student on a tie. A
 * typing-mistake answer then puts the right spelling on the students already
 * in the group that hold the replaced one (write_typo_spelling). A student who
 * joins later keeps its own.
 *
 * Everything the form shows or sends about siblings reads this one answer.
 * Children on file are not in it: the form doesn't know their groups.
 */
export function linking(students: readonly Student[]): Linking {
  const fathers = new Map(students.map((s) => [s.key, fatherName(s.name)]))
  // Each linked student's group, named by its first student.
  const group = new Map<number, number>()
  const basis = new Map<number, Basis>()
  const compared = new Map<number, Map<number, Compared>>()
  let stale: number | null = null
  const members = (g: number) => students.filter((s) => group.get(s.key) === g).map((s) => s.key)

  for (const [i, s] of students.entries()) {
    const mine = fathers.get(s.key) ?? ""
    const options = new Map<number, Compared>()
    for (const t of students.slice(0, i)) {
      const g = group.get(t.key)
      // A student in no group yet joins as matched, so it counts.
      const counted = g === undefined ? [t.key] : members(g).filter((k) => counts(basis.get(k)))
      let best: Compared | null = null
      for (const k of counted) {
        const theirs = fathers.get(k) ?? ""
        const tier = fatherNameMatch(mine, theirs) ?? "different"
        if (!best || TIER_ORDER[tier] < TIER_ORDER[best.tier]) best = { tier, with: k, theirs, father: fathers.get(t.key) ?? "" }
      }
      if (best) options.set(t.key, best)
    }
    compared.set(s.key, options)

    const sib = s.sibling
    if (!sib) continue
    const unseen = sameFatherEarlier(students, i).some((k) => !sib.seen?.includes(k))
    if (unseen) stale ??= s.key
    if (sib.kind === "none") continue
    const c = options.get(sib.of)
    // An answer the comparison no longer supports links nobody until it is given again.
    if (!c || !holds(sib, c, mine)) {
      stale ??= s.key
      continue
    }
    const g = group.get(sib.of) ?? sib.of
    if (!group.has(sib.of)) {
      group.set(sib.of, g)
      basis.set(sib.of, "matched")
    }
    group.set(s.key, g)
    basis.set(s.key, sib.kind === "match" ? "matched" : sib.kind === "typo" ? "typo_confirmed" : "request_needed")
    if (sib.kind === "typo") {
      const replaced = normalizeFatherName(sameName(sib.spelling, mine) ? c.theirs : mine)
      for (const k of members(g)) if (normalizeFatherName(fathers.get(k)) === replaced) fathers.set(k, sib.spelling)
    }
  }
  return { fathers, compared, basis, stale }
}

/** The father's name each student's record will hold once saved. */
export const savedFathers = (a: Answers) => linking(a.students).fathers
export const savedFather = (a: Answers, key: number) => savedFathers(a).get(key) ?? ""

/** Everything asked after the students, asked again: the custodians, children on file, who brought them and the fees. */
const afterStudents = (a: Answers): Answers => ({ ...a, custodians: {}, onFile: {}, onFileAsks: [], brought: undefined, feesChecked: undefined })

/**
 * The answers with every stale sibling answer taken out, so staff are asked
 * again: one at a time from the first, since taking one out changes what the
 * later ones are compared with. Every change to the students goes through
 * here, and so does a draft as it is read.
 */
export function settled(a: Answers): Answers {
  let students = a.students
  for (let stale = linking(students).stale; stale !== null; stale = linking(students).stale) {
    const key = stale
    students = students.map((s) => (s.key === key ? { ...s, sibling: undefined } : s))
  }
  return students === a.students ? a : afterStudents({ ...a, students })
}

/** A student's name answered. A different father's name asks their own sibling answer again, and every answer built on it. */
export function withName(a: Answers, key: number, name: StudentName): Answers {
  const old = a.students.find((s) => s.key === key)
  const changed = old?.name !== undefined && !sameName(fatherName(old.name), fatherName(name))
  const students = a.students.map((s) => {
    if (s.key !== key) return s
    return changed && s.sibling && s.sibling.kind !== "none" ? { ...s, name, sibling: undefined } : { ...s, name }
  })
  return changed ? settled(afterStudents({ ...a, students })) : { ...a, students }
}

/** A sibling answer given. It changes the households, so everything after the students is asked again. */
export function withSibling(a: Answers, key: number, sibling: SiblingAnswer): Answers {
  return settled(afterStudents({ ...a, students: a.students.map((s) => (s.key === key ? { ...s, sibling } : s)) }))
}

/** A student removed. Answers naming them go with them. */
export function withoutStudent(a: Answers, key: number): Answers {
  return settled(afterStudents({ ...a, more: undefined, students: a.students.filter((s) => s.key !== key) }))
}

// ---------------------------------------------------------------------------
// Years and fees.
// ---------------------------------------------------------------------------

/** The coming intake, as on the Admission form: this year before April, next year from April, in Tanzania time. */
export function comingIntake(years: readonly [number, number], tanzaniaDate: string): number {
  return Number(tanzaniaDate.slice(5, 7)) < 4 ? years[0] : years[1]
}

/** The year a student joins: theirs once picked, else the student before's, else the coming intake (as the Admission form). */
export function yearOf(students: readonly Student[], index: number, defaultYear: number): number {
  for (let i = index; i >= 0; i--) {
    const year = students[i]?.year
    if (year !== undefined) return year
  }
  return defaultYear
}

export type BandFees = Record<FeeBand, { day: number; boarding: number }>
/** Each year's band fees; a year with no Fee schedule is missing. */
export type FeeTable = Record<number, BandFees>

export function bandOf(className: LeadClass): FeeBand {
  return FEE_BANDS.find((band) => BAND_CLASSES[band].includes(className)) ?? "secondary"
}

export function feeOf(fees: FeeTable, year: number, className: LeadClass, board: DayOrBoarding): number | null {
  const bands = fees[year]
  if (!bands) return null
  const amount = bands[bandOf(className)]
  return board === "Boarding" ? amount.boarding : amount.day
}

export const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`

// ---------------------------------------------------------------------------
// Households: students linked by their sibling answers share one custodian.
// ---------------------------------------------------------------------------

export type Household = { root: number; members: number[] }

export function rootOf(students: readonly Student[], key: number): number {
  let at = key
  for (let guard = 0; guard < MOST_STUDENTS + 1; guard++) {
    const sib = students.find((s) => s.key === at)?.sibling
    if (!sib || sib.kind === "none" || !students.some((s) => s.key === sib.of)) return at
    at = sib.of
  }
  return at
}

export function households(students: readonly Student[]): Household[] {
  const out: Household[] = []
  for (const s of students) {
    const root = rootOf(students, s.key)
    const h = out.find((x) => x.root === root)
    if (h) h.members.push(s.key)
    else out.push({ root, members: [s.key] })
  }
  return out
}

/**
 * Earlier students whose father's name, as typed, is the same as this one's:
 * the sibling question names them first. The database asks its own
 * same-father question (R8) by the typed names too.
 */
export function sameFatherEarlier(students: readonly Student[], index: number): number[] {
  const own = fatherName(students[index]?.name)
  return students.slice(0, index).filter((s) => fatherNameMatch(fatherName(s.name), own) === "same").map((s) => s.key)
}

/** The three names of the father a household's first student will hold once saved: from whichever student typed that spelling. */
export function fatherParts(a: Answers, root: number): FatherName {
  const want = normalizeFatherName(savedFather(a, root))
  const from = a.students.find((s) => s.name && normalizeFatherName(fatherName(s.name)) === want) ?? a.students.find((s) => s.key === root)
  const n = from?.name
  return { fatherFirst: n?.fatherFirst ?? "", fatherMiddle: n?.fatherMiddle ?? "", fatherLast: n?.fatherLast ?? "" }
}

/** A student in this household whose father is another man: the father can't be the custodian of them all. */
export function otherFather(a: Answers, h: Household): number | null {
  const fathers = savedFathers(a)
  return h.members.find((k) => !sameName(fathers.get(k), fathers.get(h.root))) ?? null
}

// ---------------------------------------------------------------------------
// The custodians as people.
// ---------------------------------------------------------------------------

// `father`: a new person who is a household's father, named from the students.
export type Person = { name: string; phone: string; father?: boolean; payload: RegistrationPerson }

export function relationshipOf(choice: RelationshipChoice, description: string): { relationship: Relationship; relationshipDescription?: string } {
  if (choice === "Mother" || choice === "Guardian") return { relationship: choice }
  if (choice === "Other") return { relationship: "Other", relationshipDescription: description.trim() }
  return { relationship: "Other", relationshipDescription: choice }
}

export const relationshipLabel = (choice: RelationshipChoice, description: string) => (choice === "Other" ? description.trim() || "Other" : choice)

const phones = (...v: string[]) => v.map((x) => x.trim()).filter(Boolean)

/**
 * The adults on the form, each once, and the person each household's
 * custodian is. A father with no contact on file is a new person with no
 * name: the database gives him the father's full name.
 */
export function people(a: Answers): { people: Person[]; personOf: Record<number, number> } {
  const list: Person[] = []
  const personOf: Record<number, number> = {}
  const byContact = new Map<string, number>()
  const fathers = savedFathers(a)
  const add = (p: Person, contactId?: string) => {
    if (contactId && byContact.has(contactId)) return byContact.get(contactId)!
    list.push(p)
    if (contactId) byContact.set(contactId, list.length - 1)
    return list.length - 1
  }
  for (const h of households(a.students)) {
    const c = a.custodians[h.root]
    if (!c) continue
    if (c.kind === "same") {
      const first = households(a.students)[0]
      if (first && personOf[first.root] !== undefined) personOf[h.root] = personOf[first.root]
      continue
    }
    if (c.kind === "father" && !c.contact) {
      // Two households fathered by the same man on one phone are one person. Only the
      // same father's name on the same phone: any other adult with that phone stays a
      // person of their own, and the save refuses the shared number.
      const father = fathers.get(h.root) ?? ""
      const same = list.findIndex((p) => p.father && sameName(p.name, father) && digits(p.phone) === digits(c.phone))
      // His three names are sent, so a typing-mistake sibling whose spelling the save corrects shares him.
      const parts = fatherParts(a, h.root)
      personOf[h.root] =
        same >= 0
          ? same
          : add({
              name: father,
              father: true,
              phone: c.phone,
              payload: { firstName: parts.fatherFirst, middleName: parts.fatherMiddle, lastName: parts.fatherLast, phone: c.phone, whatsapp: c.whatsapp.trim() || undefined },
            })
      continue
    }
    const contact = c.kind === "father" || c.kind === "known" ? c.contact : undefined
    if (contact) {
      personOf[h.root] = add(
        { name: contact.fullName, phone: contact.phone, payload: { contactId: contact.id, alsoCheckPhones: phones(c.phone, c.whatsapp) } },
        contact.id,
      )
      continue
    }
    if (c.kind === "new") {
      personOf[h.root] = add({
        name: personName(c.name),
        phone: c.phone,
        payload: { ...c.name, phone: c.phone, whatsapp: c.whatsapp.trim() || undefined },
      })
    }
  }
  return { people: list, personOf }
}

/** "Who brought the students": each custodian once by name, keeping their place in `people()`, which the save reads. */
export function broughtChoices(list: readonly Person[]): { name: string; person: number }[] {
  return list.map((p, person) => ({ name: p.name, person })).filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i)
}

// ---------------------------------------------------------------------------
// Children on file with the same father's name (rule R8: staff are asked).
// ---------------------------------------------------------------------------

export function knownContacts(a: Answers): KnownContact[] {
  const out: KnownContact[] = []
  for (const c of Object.values(a.custodians)) {
    const contact = c.kind === "father" || c.kind === "known" ? c.contact : undefined
    if (contact && !out.some((x) => x.id === contact.id)) out.push(contact)
  }
  return out
}

/**
 * For a household's first student: the open child on file, under a contact on
 * this form, whose father's name is the same. By the name as typed: this
 * student is linked to the child on file before any sibling here is linked to
 * it, so no typing-mistake answer has changed it yet.
 */
export function onFileMatch(a: Answers, root: number): OnFileAsk | null {
  const father = fatherName(a.students.find((s) => s.key === root)?.name)
  for (const contact of knownContacts(a)) {
    const child = contact.children.find((c) => c.status !== "Declined" && c.closure === null && sameName(c.fatherFullName, father))
    if (child) return { student: root, leadId: child.id, name: child.studentName, admissionNumber: child.admissionNumber, father }
  }
  return null
}

/** The child on file a student is asked about: the save's own question, else the form's match for a household's first student. */
export function onFileAsk(a: Answers, key: number): OnFileAsk | null {
  return a.onFileAsks.find((q) => q.student === key) ?? (rootOf(a.students, key) === key ? onFileMatch(a, key) : null)
}

/** Staff's answer about that child. An answer given about another child is no answer. */
export function onFileAnswer(a: Answers, key: number): boolean | undefined {
  const given = a.onFile[key]
  const ask = onFileAsk(a, key)
  return given && ask && ask.leadId === given.leadId ? given.yes : undefined
}

/** The children on file staff linked a household to. */
export function linkedOnFile(a: Answers): OnFileAsk[] {
  return households(a.students)
    .filter((h) => onFileAnswer(a, h.root) === true)
    .map((h) => onFileAsk(a, h.root))
    .filter((q): q is OnFileAsk => !!q)
}

/**
 * A household's custodian answered. Another person may hold other children
 * on file, and the match is looked for under every custodian on the form: this
 * household's on-file answer is asked again, another household's is kept only
 * while it is still about the same child, and the save asks its own questions
 * again.
 */
export function withCustodian(a: Answers, root: number, custodian: Custodian): Answers {
  const custodians = { ...a.custodians, [root]: custodian }
  // A new first custodian: "the same person as before" now means someone else, so it is asked again.
  if (households(a.students)[0]?.root === root) {
    for (const [k, c] of Object.entries(custodians)) if (c.kind === "same") delete custodians[Number(k)]
  }
  const next: Answers = { ...a, custodians, onFileAsks: [], onFile: {}, brought: undefined, feesChecked: undefined }
  for (const [k, given] of Object.entries(a.onFile)) {
    const key = Number(k)
    const ask = onFileAsk(next, key)
    if (key !== root && ask && ask.leadId === given?.leadId) next.onFile[key] = given
  }
  return next
}

// ---------------------------------------------------------------------------
// The fee step's preview.
// ---------------------------------------------------------------------------

/** What the form knows of a child on file staff linked: its fee and its group. */
export type OnFileFee = {
  leadId: string
  name: string
  className: string
  status: string
  // The band fee before any discount; null without a Fee schedule.
  fee: number | null
  // What the child pays now.
  pays: number | null
  // A counting sibling in its group Enrolled at full, which gives every later sibling the 10%.
  anchorName: string | null
  // The group's stored full payer, if any.
  fullPayerName: string | null
}

export type FeeRow = {
  key: string
  name: string
  detail: string
  // Null for a child on file in a year with no Fee schedule: shown as "Not set".
  fee: number | null
  // 0.1 for the Sibling 10%. 0 on a tied row, where it is not known yet.
  off: number
  why: string
  tone: "good" | "wait" | "plain"
  // On a tied row, the fee with the 10%: the row pays this or the full fee.
  pays: number | null
  // Shares the household's highest fee with another new student: one of them pays full.
  tied?: boolean
  onFile?: boolean
}

export type FeePreview = { rows: FeeRow[]; total: number; together: boolean; enrolledOnFile: string | null }

/** The Discount chip on each row of a tie for the highest fee. */
export const tieWhy = (tied: number) => `Equal fees · one pays full, ${tied === 2 ? "one gets" : "the others get"} 10%`

/**
 * The prototype's rule: among proven siblings registered together, the
 * highest fee pays full and each other gets 10%. When new students share that
 * highest fee, the preview names no full payer: the database picks one of
 * them (choose_full_payer, by a random id until #467), so each tied row shows
 * both prices and the total counts one full fee. A child on file with the
 * same fee is older, so it wins the tie. A sibling joining a group on file
 * gets 10% when someone there is Enrolled at full or already pays full. A
 * Sibling request waits for the Admissions Manager, at the full fee for now.
 * Null when a new student's fee is unknown.
 */
export function feePreview(a: Answers, fees: FeeTable, defaultYear: number, onFileFees: Record<string, OnFileFee>): FeePreview | null {
  const rows: FeeRow[] = []
  let total = 0
  let together = false
  let enrolledOnFile: string | null = null
  const feeAt = new Map<number, number>()
  for (const [i, s] of a.students.entries()) {
    if (!s.className || !s.board) return null
    const f = feeOf(fees, yearOf(a.students, i, defaultYear), s.className, s.board)
    if (f === null) return null
    feeAt.set(s.key, f)
  }

  const { basis } = linking(a.students)
  for (const h of households(a.students)) {
    // The students the database counts as siblings: a Sibling request waits.
    const proven = h.members.filter((k) => k === h.root || counts(basis.get(k)))
    const ask = onFileAnswer(a, h.root) === true ? onFileAsk(a, h.root) : null
    const linked = (ask && onFileFees[ask.leadId]) || undefined
    const groupGives = linked && (linked.anchorName || linked.fullPayerName)
    let fullPayer: number | "on-file" | "tied" | null = null
    // The new students who share the highest fee, when the pick among them is the database's.
    let tied: number[] = []
    if (!groupGives && (proven.length > 1 || linked)) {
      const top = Math.max(...proven.map((k) => feeAt.get(k)!))
      const highest = proven.filter((k) => feeAt.get(k) === top)
      if (linked && linked.fee !== null && linked.fee >= top) fullPayer = "on-file"
      else if (highest.length > 1) {
        fullPayer = "tied"
        tied = highest
      } else fullPayer = highest[0]
      if (!linked) together = true
    }
    for (const k of h.members) {
      const s = a.students.find((x) => x.key === k)!
      const i = a.students.indexOf(s)
      const fee = feeAt.get(k)!
      let off = 0
      let why = "No discount"
      let tone: FeeRow["tone"] = "plain"
      if (!proven.includes(k)) {
        why = "10% requested · waits for the Manager"
        tone = "wait"
      } else if (groupGives) {
        off = 0.1
        tone = "good"
        why = linked.anchorName ? `Sibling 10% · ${firstOf(linked.anchorName)} is Enrolled` : `Sibling 10% · ${firstOf(linked.fullPayerName!)} pays full`
      } else if (tied.includes(k)) {
        why = tieWhy(tied.length)
      } else if (fullPayer !== null) {
        if (fullPayer === k) why = "Pays full · highest fee"
        else {
          off = 0.1
          tone = "good"
          why = "Sibling 10% · same father"
        }
      }
      const isTied = tied.includes(k)
      rows.push({
        key: String(k),
        name: studentName(s.name),
        detail: `${s.className} · ${s.board} · ${yearOf(a.students, i, defaultYear)}`,
        fee,
        off,
        why,
        tone,
        pays: isTied ? fee * 0.9 : fee * (1 - off),
        ...(isTied ? { tied: true } : {}),
      })
      // The tied fees are equal, so the total is the same whichever of them pays full.
      total += isTied && k !== tied[0] ? fee * 0.9 : fee * (1 - off)
    }
    if (linked) {
      const enrolled = linked.status === "Enrolled"
      if (enrolled) enrolledOnFile = linked.name
      // Null in a year with no Fee schedule: the row says "Not set", never TZS 0.
      const fee = linked.fee
      // Not yet Enrolled, the child on file follows the rule too: it pays full when it is
      // the group's payer, else it gets the 10% once a sibling joins.
      let why = "Fee kept · already Enrolled"
      let off = 0
      let pays = fee === null ? null : (linked.pays ?? fee)
      if (!enrolled) {
        const payer =
          groupGives ? linked.fullPayerName : fullPayer === "on-file" ? linked.name : typeof fullPayer === "number" ? studentName(a.students.find((x) => x.key === fullPayer)?.name) : null
        if (payer === linked.name) {
          why = "Pays full · highest fee"
          pays = fee
        } else if (payer || fullPayer === "tied") {
          // On a tie among the new students, one of them pays full: no name to give.
          why = payer ? `Sibling 10% · ${firstOf(payer)} pays full` : "Sibling 10% · same father"
          off = 0.1
          pays = fee === null ? null : fee * 0.9
        }
      }
      rows.push({ key: `file:${linked.leadId}`, name: linked.name, detail: `${linked.className} · already ${linked.status}`, fee, off, why, tone: off ? "good" : "plain", pays, onFile: true })
    }
  }
  return { rows, total, together, enrolledOnFile }
}

/** What the fee step showed, so a preview that changes after it was accepted is asked again. */
export const feeSignature = (p: FeePreview) => p.rows.map((r) => `${r.key}:${r.fee}:${r.off}:${r.why}`).join("|")

/** The sibling discount is mentioned only when the family has more than one child, on this form or on file (v38). */
export const mentionsSiblings = (a: Answers, preview: FeePreview | null) => a.students.length > 1 || !!preview?.rows.some((r) => r.onFile)

// ---------------------------------------------------------------------------
// The save.
// ---------------------------------------------------------------------------

/** "Fathers' names don't match" is the request's reason when staff leave the note empty. */
export const DEFAULT_REQUEST_NOTE = "Fathers' names don't match."

/**
 * Whether staff already said this unlinked student is not a sibling of a
 * student here with the same father's name, which the save would otherwise
 * ask (R8). Either they answered Not a sibling with an earlier one named in
 * the question, or a later one was asked about them by name and linked
 * elsewhere.
 */
function saidNotASibling(a: Answers, index: number): boolean {
  const s = a.students[index]
  if (s.sibling?.kind === "none" && sameFatherEarlier(a.students, index).length > 0) return true
  return a.students.slice(index + 1).some((t) => {
    if (!t.sibling || rootOf(a.students, t.key) === s.key || !sameName(fatherName(t.name), fatherName(s.name))) return false
    return t.sibling.kind !== "none" || onFileAnswer(a, t.key) === true
  })
}

export function payload(a: Answers, defaultYear: number): { people: RegistrationPerson[]; students: RegistrationStudent[] } {
  const { people: list, personOf } = people(a)
  const { compared } = linking(a.students)
  const number = (key: number) => a.students.findIndex((s) => s.key === key) + 1
  const students = a.students.map((s, i): RegistrationStudent => {
    const root = rootOf(a.students, s.key)
    const c = a.custodians[root]
    const person = (personOf[root] ?? 0) + 1
    const custodian: RegistrationStudent["custodian"] =
      c?.kind === "father" ? { person, father: true } : { person, ...(c ? relationshipOf(c.relationship, c.description) : { relationship: "Guardian" as const }) }
    const out: RegistrationStudent = {
      firstName: s.name?.firstName ?? "",
      fatherFirst: s.name?.fatherFirst ?? "",
      fatherMiddle: s.name?.fatherMiddle ?? "",
      fatherLast: s.name?.fatherLast ?? "",
      className: s.className!,
      enrollmentYear: yearOf(a.students, i, defaultYear),
      dayOrBoarding: s.board!,
      custodian,
    }
    if (s.className && !NO_SCHOOL_ASKED.includes(s.className) && s.school) {
      out.previousSchool = "notKnown" in s.school ? { notKnown: true } : s.school
    }
    const sib = s.sibling
    if (sib && sib.kind !== "none") {
      out.siblingOf = { student: number(sib.of) }
      if (sib.kind === "typo") out.nameAnswer = { answer: "typo", spelling: sib.spelling }
      if (sib.kind === "request") {
        // Close names the database asks about; staff said they are two names.
        if (compared.get(s.key)?.get(sib.of)?.tier === "close") out.nameAnswer = { answer: "different" }
        out.requestNote = sib.note.trim() || DEFAULT_REQUEST_NOTE
        out.requestId = sib.requestId
      }
    } else {
      const ask = onFileAsk(a, s.key)
      const said = onFileAnswer(a, s.key)
      if (ask && said === true) {
        out.siblingOf = { leadId: ask.leadId }
        out.siblingFatherFullName = ask.father
      } else if ((ask && said === false) || saidNotASibling(a, i)) {
        out.notASibling = true
      }
    }
    const b = a.brought
    if (b?.who === "else") out.broughtBy = { name: b.name, phone: b.phone.trim() || undefined, relationship: b.relationship.trim() || undefined }
    else if (b?.who === "person" && list[b.person]) {
      const p = list[b.person]
      const own = personOf[root] === b.person && c && c.kind !== "father" ? relationshipLabel(c.relationship, c.description) : c?.kind === "father" && personOf[root] === b.person ? "Father" : undefined
      out.broughtBy = { name: p.name, phone: p.phone || undefined, relationship: own }
    }
    return out
  })
  return { people: list.map((p) => p.payload), students }
}
