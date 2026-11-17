import type { FatherName, PersonName, StudentName } from "@/components/guided-form"
import { fatherNameMatch, normalizeFatherName } from "@/lib/father-name"
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

/** The answer to "Is X a sibling of another student here?", naming the earlier student by key. */
export type SiblingAnswer =
  | { kind: "none" }
  | { kind: "match"; of: number }
  // Close names that staff called one name with a typing mistake: `spelling` is the right father's name.
  | { kind: "typo"; of: number; spelling: string }
  // A Sibling request for the Admissions Manager. `close`: the names were close and staff said two names.
  | { kind: "request"; of: number; note: string; requestId: string; close: boolean }

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
  // By the student's key: yes links to that child on file.
  onFile: Record<number, boolean>
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

/** The father's name the student's record will hold once saved: a typing-mistake answer puts the right spelling on both. */
export function savedFather(a: Answers, key: number): string {
  const s = a.students.find((x) => x.key === key)
  const own = fatherName(s?.name)
  for (const other of a.students) {
    const sib = other.sibling
    if (sib?.kind !== "typo") continue
    const ends = [other.key, sib.of]
    if (!ends.includes(key)) continue
    const replaced = other.key === key ? fatherName(a.students.find((x) => x.key === sib.of)?.name) : fatherName(other.name)
    if (normalizeFatherName(own) !== normalizeFatherName(sib.spelling) && normalizeFatherName(replaced) === normalizeFatherName(sib.spelling)) return sib.spelling
  }
  return own
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

/** Earlier students whose father's name is the same as this one's: the sibling question names them first. */
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
  const root = savedFather(a, h.root)
  return h.members.find((k) => fatherNameMatch(savedFather(a, k), root) !== "same") ?? null
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
      const same = list.findIndex(
        (p) => p.father && fatherNameMatch(p.name, savedFather(a, h.root)) === "same" && digits(p.phone) === digits(c.phone),
      )
      // His three names are sent, so a typing-mistake sibling whose spelling the save corrects shares him.
      const parts = fatherParts(a, h.root)
      personOf[h.root] =
        same >= 0
          ? same
          : add({
              name: savedFather(a, h.root),
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

/** For a household's first student: the open child on file, under a contact on this form, whose father's name is the same. */
export function onFileMatch(a: Answers, root: number): OnFileAsk | null {
  const father = savedFather(a, root)
  for (const contact of knownContacts(a)) {
    const child = contact.children.find(
      (c) => c.status !== "Declined" && c.closure === null && fatherNameMatch(c.fatherFullName, father) === "same",
    )
    if (child) return { student: root, leadId: child.id, name: child.studentName, admissionNumber: child.admissionNumber, father }
  }
  return null
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
  fee: number
  // 0.1 for the Sibling 10%.
  off: number
  why: string
  tone: "good" | "wait" | "plain"
  pays: number
  onFile?: boolean
}

export type FeePreview = { rows: FeeRow[]; total: number; together: boolean; enrolledOnFile: string | null }

/**
 * The prototype's rule: among proven siblings registered together, the
 * highest fee pays full (the earlier student on a tie) and each other gets
 * 10%. A sibling joining a group on file gets 10% when someone there is
 * Enrolled at full or already pays full. A Sibling request waits for the
 * Admissions Manager, at the full fee for now. Null when a fee is unknown.
 */
export function feePreview(a: Answers, fees: FeeTable, defaultYear: number, onFileFees: Record<string, OnFileFee | null>): FeePreview | null {
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

  for (const h of households(a.students)) {
    const proven = h.members.filter((k) => {
      if (k === h.root) return true
      const sib = a.students.find((s) => s.key === k)?.sibling
      return sib?.kind === "match" || sib?.kind === "typo"
    })
    const ask = a.onFileAsks.find((q) => q.student === h.root && a.onFile[h.root]) ?? (a.onFile[h.root] ? onFileMatch(a, h.root) : null)
    const linked = (ask && onFileFees[ask.leadId]) || undefined
    const groupGives = linked && (linked.anchorName || linked.fullPayerName)
    let fullPayer: number | "on-file" | null = null
    if (!groupGives && (proven.length > 1 || linked)) {
      const best = proven.reduce((x, y) => (feeAt.get(y)! > feeAt.get(x)! ? y : x), proven[0])
      fullPayer = linked && linked.fee !== null && linked.fee >= feeAt.get(best)! ? "on-file" : best
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
      } else if (fullPayer !== null) {
        if (fullPayer === k) why = "Pays full · highest fee"
        else {
          off = 0.1
          tone = "good"
          why = "Sibling 10% · same father"
        }
      }
      rows.push({
        key: String(k),
        name: studentName(s.name),
        detail: `${s.className} · ${s.board} · ${yearOf(a.students, i, defaultYear)}`,
        fee,
        off,
        why,
        tone,
        pays: fee * (1 - off),
      })
      total += fee * (1 - off)
    }
    if (linked) {
      const enrolled = linked.status === "Enrolled"
      if (enrolled) enrolledOnFile = linked.name
      const fee = linked.fee ?? 0
      // Not yet Enrolled, the child on file follows the rule too: it pays full when it is
      // the group's payer, else it gets the 10% once a sibling joins.
      let why = "Fee kept · already Enrolled"
      let off = 0
      let pays = linked.pays ?? fee
      if (!enrolled) {
        const payer = groupGives ? linked.fullPayerName : fullPayer === "on-file" ? linked.name : fullPayer === null ? null : studentName(a.students.find((x) => x.key === fullPayer)?.name)
        if (payer === linked.name) {
          why = "Pays full · highest fee"
          pays = fee
        } else if (payer) {
          why = `Sibling 10% · ${firstOf(payer)} pays full`
          off = 0.1
          pays = fee * 0.9
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

export function payload(a: Answers, defaultYear: number): { people: RegistrationPerson[]; students: RegistrationStudent[] } {
  const { people: list, personOf } = people(a)
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
        if (sib.close) out.nameAnswer = { answer: "different" }
        out.requestNote = sib.note.trim() || DEFAULT_REQUEST_NOTE
        out.requestId = sib.requestId
      }
    } else {
      const ask = a.onFileAsks.find((q) => q.student === s.key) ?? (root === s.key ? onFileMatch(a, s.key) : null)
      if (ask && a.onFile[s.key] === true) {
        out.siblingOf = { leadId: ask.leadId }
        out.siblingFatherFullName = ask.father
      } else if (ask && a.onFile[s.key] === false) {
        out.notASibling = true
      } else if (sib?.kind === "none" && sameFatherEarlier(a.students, i).length > 0) {
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
