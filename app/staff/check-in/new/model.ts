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
  StudentGender,
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
  // Boy or girl (prototype v41, #449).
  gender?: StudentGender
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

/**
 * Staff's answer, on a sheet, about one student joining a child on file's
 * sibling group: that group may count by another father's name than the
 * child's own. `against` is the name the sheet showed beside the student's.
 * `fromSave`: the save itself asked, so the answer is sent as given.
 */
export type OnFileLink =
  | { kind: "typo"; spelling: string; against: string; fromSave?: boolean }
  | { kind: "request"; note: string; requestId: string; close: boolean; against: string; fromSave?: boolean }

/** Staff's answer about one child on file. `links`: by student of that household, the sheet answers a Yes needed. */
export type OnFileGiven = { leadId: string; yes: boolean; links?: Record<number, OnFileLink> }

export type Answers = {
  students: Student[]
  more?: true
  // By the household's first student's key.
  custodians: Record<number, Custodian>
  // Questions the save raised about a child on file, kept until answered.
  onFileAsks: OnFileAsk[]
  // By the student's key: staff's answer about one child on file. Yes links to that child, and no other.
  onFile: Record<number, OnFileGiven>
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
const BASIS = { match: "matched", typo: "typo_confirmed", request: "request_needed" } as const

/** What a link to an earlier student compares, at the moment it is made. */
export type Compared = {
  // Which question staff get: same is a match, close asks "one name, or two?", different is a request.
  tier: FatherNameMatch
  // The counting student of that group this student is compared with, and its father's name then.
  // Null when it is a member on file of a child on file's group: `onFile` is that member's name.
  with: number | null
  theirs: string
  onFile?: string
  // The earlier student's own father's name then.
  father: string
}

/**
 * A household's link to a child on file: what the form read of the child's
 * group, the father's name the question showed, and the sheet answers given.
 */
export type OnFileLinked = { read: OnFileFee; father: string; links: Record<number, OnFileLink> }
export type OnFileLinks = ReadonlyMap<number, OnFileLinked>
const NO_FILES: OnFileLinks = new Map()

/** A sibling group as the save will make it: a form group is named by its first student, a group on file by its id. */
type GroupId = number | string

export type Linking = {
  // The father's name each record holds once every link is saved.
  fathers: Map<number, string>
  // By student, then by earlier student: what a link to that one compares.
  compared: Map<number, Map<number, Compared>>
  // By household's first student linked to a child on file: what that link compares.
  onFile: Map<number, Compared>
  // Linked students only. A household's first student is matched.
  basis: Map<number, Basis>
  // Linked students only: the group each is in.
  group: Map<number, GroupId>
  // The first student whose sibling answer is not for the question the form asks now.
  stale: number | null
  // The first student whose link into a group on file still needs an answer from staff.
  ask: { student: number; compared: Compared } | null
}

function holds(sib: Exclude<SiblingAnswer, { kind: "none" }>, c: Compared, mine: string): boolean {
  if (sib.kind === "match") return c.tier === "same"
  if (!sameName(sib.against, c.theirs)) return false
  if (sib.kind === "typo") return c.tier === "close" && (sameName(sib.spelling, mine) || sameName(sib.spelling, c.theirs))
  return c.tier === (sib.close ? "close" : "different")
}

type FileAnswer = { kind: "match" } | { kind: "typo"; spelling: string } | { kind: "request" }

/**
 * How a student joins a group on file, as link_sibling_locked reads the
 * answers sent: the same name needs none; a close name needs "one name, or
 * two?", and a typing mistake's spelling must be one of the two names; any
 * other name is a Sibling request. The student's own sibling answer serves
 * when it still answers that, else the sheet answer given about this group.
 * Null when staff must still be asked.
 */
function fileAnswer(c: Compared, mine: string, link: OnFileLink | undefined, own?: Exclude<SiblingAnswer, { kind: "none" }>): FileAnswer | null {
  if (link?.fromSave) return link
  if (c.tier === "same") return { kind: "match" }
  const answers = (x: { kind: "typo"; spelling: string } | { kind: "request" }) =>
    x.kind === "request" || (c.tier === "close" && (sameName(x.spelling, mine) || sameName(x.spelling, c.theirs)))
  if (own && own.kind !== "match" && answers(own)) return own
  if (link && sameName(link.against, c.theirs) && answers(link)) return link
  return null
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
 *
 * With `files`, a household's first student joins its child on file's group
 * at its own turn, as the save links it. That group counts by its members on
 * file, never by one waiting on a Sibling request, so the student and each
 * sibling linked to it after are compared with those names too. Without
 * `files`, the form's students alone: the sibling answers are asked before
 * any child on file is known, and `stale` is about those questions only.
 */
export function linking(students: readonly Student[], files: OnFileLinks = NO_FILES): Linking {
  const fathers = new Map(students.map((s) => [s.key, fatherName(s.name)]))
  const group = new Map<number, GroupId>()
  const basis = new Map<number, Basis>()
  const compared = new Map<number, Map<number, Compared>>()
  const onFile = new Map<number, Compared>()
  // By group on file: the members on file it counts by, with the names they hold as the links are made,
  // and the child staff linked to, named when the group counts nobody.
  const filed = new Map<string, { name: string; father: string }[]>()
  const child = new Map<string, { name: string; father: string }>()
  let stale: number | null = null
  let ask: Linking["ask"] = null
  const members = (g: GroupId) => students.filter((s) => group.get(s.key) === g).map((s) => s.key)

  // What a link into group `g` compares. `t`: the student linked to, who counts when it is in no group yet.
  const best = (mine: string, g: GroupId | undefined, t: number | null, father: string): Compared | null => {
    const counted: Pick<Compared, "with" | "theirs" | "onFile">[] =
      g === undefined
        ? [{ with: t, theirs: (t === null ? undefined : fathers.get(t)) ?? "" }]
        : [
            ...(typeof g === "string" ? (filed.get(g) ?? []).map((m) => ({ with: null, theirs: m.father, onFile: m.name })) : []),
            ...members(g).filter((k) => counts(basis.get(k))).map((k) => ({ with: k, theirs: fathers.get(k) ?? "" })),
          ]
    let found: Compared | null = null
    for (const c of counted) {
      const tier = fatherNameMatch(mine, c.theirs) ?? "different"
      if (!found || TIER_ORDER[tier] < TIER_ORDER[found.tier]) found = { tier, ...c, father }
    }
    // A group on file that counts nobody: the database finds no name to compare, which is a Sibling request.
    const c = typeof g === "string" ? child.get(g) : undefined
    return found ?? (c ? { tier: "different", with: null, theirs: c.father, onFile: c.name, father } : null)
  }
  const join = (key: number, g: GroupId, how: FileAnswer["kind"]) => {
    group.set(key, g)
    basis.set(key, BASIS[how])
  }
  // A typing mistake: the right spelling goes on everyone already in the group who holds the replaced one.
  const respell = (g: GroupId, spelling: string, mine: string, theirs: string) => {
    const replaced = normalizeFatherName(sameName(spelling, mine) ? theirs : mine)
    for (const k of members(g)) if (normalizeFatherName(fathers.get(k)) === replaced) fathers.set(k, spelling)
    if (typeof g === "string") for (const m of filed.get(g) ?? []) if (normalizeFatherName(m.father) === replaced) m.father = spelling
  }

  for (const [i, s] of students.entries()) {
    const mine = fathers.get(s.key) ?? ""
    const options = new Map<number, Compared>()
    for (const t of students.slice(0, i)) {
      const c = best(mine, group.get(t.key), t.key, fathers.get(t.key) ?? "")
      if (c) options.set(t.key, c)
    }
    compared.set(s.key, options)

    const sib = s.sibling
    if (sib) {
      const unseen = sameFatherEarlier(students, i).some((k) => !sib.seen?.includes(k))
      if (unseen) stale ??= s.key
    }
    if (!sib || sib.kind === "none") {
      // A household's first student, linked to its child on file.
      const file = files.get(s.key)
      if (!file) continue
      const g = `file:${file.read.groupId ?? file.read.leadId}`
      const self = { name: file.read.name, father: file.read.father ?? file.father }
      if (!filed.has(g)) {
        filed.set(g, [...(file.read.selfCounts ? [self] : []), ...file.read.counted.map((m) => ({ name: m.name, father: m.father }))])
        child.set(g, self)
      }
      const c = best(mine, g, null, self.father)
      if (!c) continue
      onFile.set(s.key, c)
      const how = fileAnswer(c, mine, file.links[s.key])
      if (!how) {
        ask ??= { student: s.key, compared: c }
        continue
      }
      join(s.key, g, how.kind)
      if (how.kind === "typo") respell(g, how.spelling, mine, c.theirs)
      continue
    }
    const c = options.get(sib.of)
    const to = group.get(sib.of)
    if (c && typeof to === "string") {
      // The sibling is in a group on file: the answer given before that was known may not be the one the save needs.
      const how = fileAnswer(c, mine, files.get(rootOf(students, s.key))?.links[s.key], sib)
      if (!how) {
        ask ??= { student: s.key, compared: c }
        continue
      }
      join(s.key, to, how.kind)
      if (how.kind === "typo") respell(to, how.spelling, mine, c.theirs)
      continue
    }
    // An answer the comparison no longer supports links nobody until it is given again.
    if (!c || !holds(sib, c, mine)) {
      stale ??= s.key
      continue
    }
    const g = to ?? sib.of
    if (!group.has(sib.of)) join(sib.of, g, "match")
    join(s.key, g, sib.kind)
    if (sib.kind === "typo") respell(g, sib.spelling, mine, c.theirs)
  }
  return { fathers, compared, onFile, basis, group, stale, ask }
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

/** Staff's answer about a child on file, kept by the student asked. It changes the fees, so they are checked again. */
export function withOnFile(a: Answers, student: number, given: OnFileGiven): Answers {
  return { ...a, onFile: { ...a.onFile, [student]: given }, feesChecked: undefined }
}

/** Each household staff linked to a child on file whose group the form has read, for linking(). */
export function onFileLinks(a: Answers, reads: Record<string, OnFileFee>): OnFileLinks {
  const out = new Map<number, OnFileLinked>()
  for (const h of households(a.students)) {
    if (onFileAnswer(a, h.root) !== true) continue
    const ask = onFileAsk(a, h.root)
    const read = ask ? reads[ask.leadId] : undefined
    if (ask && read) out.set(h.root, { read, father: ask.father, links: a.onFile[h.root]?.links ?? {} })
  }
  return out
}

/**
 * The next student of a household whose link into its child on file's group
 * staff must answer on a sheet, with the names it compares: the household's
 * first student, then each sibling linked to it. Null when the save needs no
 * more answers from this household.
 */
export function onFileQuestion(a: Answers, reads: Record<string, OnFileFee>, root: number): Linking["ask"] {
  const ask = linking(a.students, onFileLinks(a, reads)).ask
  return ask && rootOf(a.students, ask.student) === root ? ask : null
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

/** What the form knows of a child on file staff linked: its fee and its group, as the database holds them now. */
export type OnFileFee = {
  leadId: string
  name: string
  className: string
  status: string
  // The band fee before any discount; null without a Fee schedule.
  fee: number | null
  // Its School fee now, after any discount it holds.
  pays: number | null
  // A counting sibling in its group Enrolled at full, which gives every later sibling the 10%.
  anchorName: string | null
  // The group's stored full payer, if any.
  fullPayerName: string | null
  // Its sibling group; null when it is in none yet.
  groupId: string | null
  // The father's name on its record.
  father: string | null
  // The other members whose fathers' names the database compares a new sibling's with (sibling_name_check):
  // those the group counts by, lowest lead id first. Never one waiting on a Sibling request, or refused.
  counted: { leadId: string; name: string; father: string }[]
  // The child itself is compared too: it is in no group yet, or its group counts it.
  selfCounts: boolean
  // Whether the database may choose it as the full payer (choose_full_payer): it counts, is open and not
  // Enrolled, and holds no manual result, no result fixed at an enrolment and no larger discount.
  mayPayFull: boolean
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
  // Shares the group's highest fee with another new student: one of them pays full.
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
 * both prices and the total counts one full fee. A sibling joining a group on
 * file gets 10% when someone there is Enrolled at full or already pays full.
 * A Sibling request waits for the Admissions Manager, at the full fee for now.
 * Null when a new student's fee is unknown.
 *
 * The groups are the ones the save makes: households linked to the same child
 * on file, or to children in one group on file, are one group with one full
 * payer. A child on file with the same fee is older, so it wins the tie, but
 * only one the database may choose: a child with a larger discount, a manual
 * or fixed result, or waiting on a Sibling request keeps the fee it has.
 *
 * `kept`, at check-in (#309): by student key, the group a child already in a
 * sibling group keeps, as read on file. Its household counts with that group,
 * as the save leaves it, and its row takes the fee the rule gives it there.
 */
export function feePreview(
  a: Answers,
  fees: FeeTable,
  defaultYear: number,
  onFileFees: Record<string, OnFileFee>,
  kept: Record<number, OnFileFee> = {},
): FeePreview | null {
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

  const { basis } = linking(a.students, onFileLinks(a, onFileFees))
  const all = households(a.students)
  const keptLeads = new Set(Object.values(kept).map((k) => k.leadId))
  const linkedTo = (h: Household) => {
    if (kept[h.root]) return kept[h.root]
    const ask = onFileAnswer(a, h.root) === true ? onFileAsk(a, h.root) : null
    return (ask && onFileFees[ask.leadId]) || undefined
  }
  type Group = { id: string | null; households: Household[]; linked: OnFileFee[] }
  const groups: Group[] = []
  // Each child on file is shown once, after the last household linked to it.
  const shownAfter = new Map<string, number>()
  for (const h of all) {
    const linked = linkedTo(h)
    // Kept siblings beyond the household's first share its group: their own reads come too.
    const reads = [...(linked ? [linked] : []), ...h.members.filter((k) => k !== h.root && kept[k]).map((k) => kept[k])]
    const id = linked ? (linked.groupId ?? linked.leadId) : null
    const g = id === null ? undefined : groups.find((x) => x.id === id)
    if (!g) groups.push({ id, households: [h], linked: reads })
    else {
      g.households.push(h)
      for (const r of reads) if (!g.linked.some((l) => l.leadId === r.leadId)) g.linked.push(r)
    }
    if (linked) shownAfter.set(linked.leadId, h.root)
  }

  const newRows = new Map<number, Pick<FeeRow, "off" | "why" | "tone"> & { tied: boolean; counted: number }>()
  const fileRows = new Map<string, FeeRow>()
  for (const g of groups) {
    // The students the database counts as siblings: a Sibling request waits.
    const proven = g.households.flatMap((h) => h.members.filter((k) => !kept[k] && (basis.has(k) ? counts(basis.get(k)) : k === h.root)))
    const giver = g.linked.find((l) => l.anchorName || l.fullPayerName)
    let fullPayer: number | OnFileFee | "tied" | null = null
    // The new students who share the highest fee, when the pick among them is the database's.
    let tied: number[] = []
    if (!giver && proven.length > 0 && (proven.length > 1 || g.linked.length > 0)) {
      const top = Math.max(...proven.map((k) => feeAt.get(k)!))
      const highest = proven.filter((k) => feeAt.get(k) === top)
      const [onFile] = g.linked.filter((l) => l.mayPayFull && l.fee !== null && l.fee >= top).sort((x, y) => y.fee! - x.fee!)
      if (onFile) fullPayer = onFile
      else if (highest.length > 1) {
        fullPayer = "tied"
        tied = highest
      } else fullPayer = highest[0]
      if (g.linked.length === 0) together = true
    }
    for (const k of g.households.flatMap((h) => h.members)) {
      if (kept[k]) continue
      const fee = feeAt.get(k)!
      let off = 0
      let why = "No discount"
      let tone: FeeRow["tone"] = "plain"
      if (!proven.includes(k)) {
        why = "10% requested · waits for the Manager"
        tone = "wait"
      } else if (giver) {
        off = 0.1
        tone = "good"
        why = giver.anchorName ? `Sibling 10% · ${firstOf(giver.anchorName)} is Enrolled` : `Sibling 10% · ${firstOf(giver.fullPayerName!)} pays full`
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
      // The tied fees are equal, so the total is the same whichever of them pays full.
      newRows.set(k, { off, why, tone, tied: tied.includes(k), counted: tied.includes(k) && k !== tied[0] ? fee * 0.9 : fee * (1 - off) })
    }
    for (const linked of g.linked) {
      const enrolled = linked.status === "Enrolled"
      if (enrolled) enrolledOnFile = linked.name
      // Null in a year with no Fee schedule: the row says "Not set", never TZS 0.
      const fee = linked.fee
      // The fee it has now, kept unless the rule changes it below.
      let why = enrolled ? "Fee kept · already Enrolled" : "Fee kept"
      let off = 0
      let pays = fee === null ? null : (linked.pays ?? fee)
      if (!enrolled) {
        const payer = giver
          ? giver.fullPayerName
          : typeof fullPayer === "number"
            ? studentName(a.students.find((x) => x.key === fullPayer)?.name)
            : fullPayer !== null && fullPayer !== "tied"
              ? fullPayer.name
              : null
        if (giver ? payer === linked.name : fullPayer === linked) {
          why = "Pays full · highest fee"
          pays = fee
        } else if (linked.mayPayFull && (giver || fullPayer !== null)) {
          // Not yet Enrolled, a child on file the rule reaches gets the 10% beside the payer.
          // On a tie among the new students, one of them pays full: no name to give.
          why = giver?.anchorName ? `Sibling 10% · ${firstOf(giver.anchorName)} is Enrolled` : payer ? `Sibling 10% · ${firstOf(payer)} pays full` : "Sibling 10% · same father"
          off = 0.1
          pays = fee === null ? null : fee * 0.9
        }
      }
      fileRows.set(linked.leadId, { key: `file:${linked.leadId}`, name: linked.name, detail: `${linked.className} · already ${linked.status}`, fee, off, why, tone: off ? "good" : "plain", pays, onFile: true })
    }
  }

  for (const h of all) {
    for (const k of h.members) {
      const s = a.students.find((x) => x.key === k)!
      const own = kept[k] ? fileRows.get(kept[k].leadId) : undefined
      if (own) {
        // A child already in a sibling group: the fee the rule gives it there, shown as the student it is.
        rows.push({ ...own, key: String(k), name: studentName(s.name), detail: `${s.className} · ${s.board} · ${yearOf(a.students, a.students.indexOf(s), defaultYear)}`, onFile: undefined })
        total += own.pays ?? feeAt.get(k)!
        continue
      }
      const fee = feeAt.get(k)!
      const { off, why, tone, tied, counted } = newRows.get(k)!
      rows.push({
        key: String(k),
        name: studentName(s.name),
        detail: `${s.className} · ${s.board} · ${yearOf(a.students, a.students.indexOf(s), defaultYear)}`,
        fee,
        off,
        why,
        tone,
        pays: tied ? fee * 0.9 : fee * (1 - off),
        ...(tied ? { tied: true } : {}),
      })
      total += counted
    }
    for (const [leadId, after] of shownAfter) if (after === h.root && !keptLeads.has(leadId)) rows.push(fileRows.get(leadId)!)
  }
  return { rows, total, together, enrolledOnFile }
}

/** What the fee step showed, so a preview that changes after it was accepted is asked again. */
export const feeSignature = (p: FeePreview) => p.rows.map((r) => `${r.key}:${r.fee}:${r.off}:${r.why}`).join("|")

/** The sibling discount is mentioned only when the family has more than one child, on this form or on file (v38). */
export const mentionsSiblings = (a: Answers, preview: FeePreview | null) => a.students.length > 1 || !!preview?.rows.some((r) => r.onFile || r.off > 0)

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

/**
 * The form as the save takes it. `onFileFees`: what the form read of each
 * linked child on file, so a sibling's link into that child's group is sent
 * with the answer that group needs.
 */
export function payload(a: Answers, defaultYear: number, onFileFees: Record<string, OnFileFee> = {}): { people: RegistrationPerson[]; students: RegistrationStudent[] } {
  const { people: list, personOf } = people(a)
  const { compared } = linking(a.students, onFileLinks(a, onFileFees))
  const number = (key: number) => a.students.findIndex((s) => s.key === key) + 1
  // The sheet answer about a group on file is the one sent, in the fields a form sibling's answer uses.
  const answered = (out: RegistrationStudent, link: OnFileLink) => {
    if (link.kind === "typo") out.nameAnswer = { answer: "typo", spelling: link.spelling }
    else {
      // Sent with every request: the database reads it only if it finds the names close.
      out.nameAnswer = { answer: "different" }
      out.requestNote = link.note.trim() || DEFAULT_REQUEST_NOTE
      out.requestId = link.requestId
    }
  }
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
      gender: s.gender!,
      className: s.className!,
      enrollmentYear: yearOf(a.students, i, defaultYear),
      dayOrBoarding: s.board!,
      custodian,
    }
    if (s.className && !NO_SCHOOL_ASKED.includes(s.className) && s.school) {
      out.previousSchool = "notKnown" in s.school ? { notKnown: true } : s.school
    }
    const sib = s.sibling
    const link = onFileAnswer(a, root) === true ? a.onFile[root]?.links?.[s.key] : undefined
    if (sib && sib.kind !== "none") {
      out.siblingOf = { student: number(sib.of) }
      if (link) answered(out, link)
      else if (sib.kind === "typo") out.nameAnswer = { answer: "typo", spelling: sib.spelling }
      else if (sib.kind === "request") {
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
        if (link) answered(out, link)
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
