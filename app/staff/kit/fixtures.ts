import type { LeadStatus } from "@/lib/services/leads"

// Example data copied from the approved prototype (version 13). Every name and
// number here is made up; none belongs to a family.

export type Applicant = {
  name: string
  number: string
  cls: string
  custodian: string
  status: LeadStatus
  next: string
  father: string
  school: string
  relationship: string
  broughtBy: string
  /** Leave out for a Declined student: the record shows no fee. */
  fee?: string
  paid?: string
}

export const APPLICANTS: Applicant[] = [
  {
    name: "Salma Juma Salim Mrisho",
    number: "DMSN-90001",
    cls: "STD 4",
    custodian: "Mwanaidi Salim Juma",
    status: "Enrolled",
    next: "Nothing to do",
    father: "Juma Salim Mrisho",
    school: "Example Primary School · Public · Dar es Salaam",
    relationship: "Mother",
    broughtBy: "Mwanaidi Salim Juma",
    fee: "TZS 1,800,000",
    paid: "TZS 600,000",
  },
  {
    name: "Baraka Mfano",
    number: "DMSN-90002",
    cls: "FORM 2",
    custodian: "Asha Mfano",
    status: "Interviewed",
    next: "Release the result",
    father: "Mfano",
    school: "Mfano Secondary School · Private · Pwani",
    relationship: "Mother",
    broughtBy: "Asha Mfano",
    fee: "TZS 2,600,000",
    paid: "TZS 0",
  },
  {
    name: "Amani Daudi Petro",
    number: "DMSN-90003",
    cls: "KG 2",
    custodian: "Daudi Petro Amani",
    status: "Visited",
    next: "Book the interview",
    father: "Daudi Petro",
    school: "Not asked below STD 2",
    relationship: "Father",
    broughtBy: "Neema Petro (aunt)",
    fee: "TZS 1,400,000",
    paid: "TZS 0",
  },
  {
    name: "Juma Khamis Ali",
    number: "DMSN-90007",
    cls: "STD 7",
    custodian: "Khamis Ali Juma",
    status: "Declined",
    next: "Nothing to do",
    father: "Khamis Ali",
    school: "Mfano Primary School · Public · Tanga",
    relationship: "Father",
    broughtBy: "Khamis Ali Juma",
  },
]

export const FILTERS = ["All", "Applied", "Visited", "Interviewed", "Enrolled", "Declined"]

export const FEE_SCHEDULE: [string, string, string, string][] = [
  ["DAY CARE", "TZS 1,200,000", "Not offered", "TZS 200,000"],
  ["STD 1 to STD 4", "TZS 1,800,000", "TZS 3,300,000", "TZS 300,000"],
  ["STD 5 to STD 7", "TZS 2,000,000", "TZS 3,500,000", "TZS 300,000"],
  ["FORM 1 to FORM 4", "TZS 2,600,000", "TZS 4,100,000", "TZS 500,000"],
]

export const DISCOUNT_REQUESTS = [
  {
    name: "Latifa Omari Juma Hassan",
    kind: "Sibling · 10%",
    why: "Fathers’ names don’t match",
    by: "Example Staff One · today 09:20",
    detail: "Sibling of Bakari Rashidi Kombo Said. Fathers on record: Omari Juma Hassan and Rashidi Kombo Said.",
    proof: "Same mother, full custody. Both birth certificates promised for Thursday.",
  },
  {
    name: "Saidi Khamis Mussa Haji",
    kind: "Sibling · 10%",
    why: "Fathers’ names don’t match",
    by: "Example Staff Two · 2 days ago",
    detail: "Sibling of Mwanaisha Hamad Juma Ali. Fathers on record: Khamis Mussa Haji and Hamad Juma Ali. Both students are already Enrolled at the full fee.",
    proof: "Same mother, full custody. Both birth certificates seen at the desk.",
  },
  {
    name: "Amani Daudi Petro",
    kind: "Staff child · 25%",
    why: "Parent works at the school",
    by: "Example Staff One · yesterday",
    detail: "Custodian Daudi Petro Amani is on the teaching staff.",
    proof: "Staff ID seen at the desk.",
  },
]

export const CAMPUS: { when: string; name: string; about: string; status: LeadStatus; checkIn?: boolean }[] = [
  { when: "Expected", name: "Yusuf and Mariam Ali Hassan", about: "STD 6 and STD 1 · sent the Admission form", status: "Applied", checkIn: true },
  { when: "09:10", name: "Baraka Mfano", about: "FORM 2 · result ready to release", status: "Interviewed" },
]

export const PAYMENT_KINDS = ["Initial deposit", "First instalment", "Second instalment", "Third instalment", "Full payment"]

/** A student's record as the Applicants side sheet shows it (prototype, `APPS`). */
export type SheetApplicant = {
  name: string
  number: string
  cls: string
  custodian: string
  status: LeadStatus
  next: string
  relationship?: string
  broughtBy?: string
  /** The previous school; "not-known" for a school saved as Not known yet. */
  school?: string
  /** The father's name when staff corrected it; otherwise the student's names after the first. */
  father?: string
  sibling?: string
  /** The sibling discount on the fee: 0.1 for 10%. */
  share?: number
  /** Why the fee is what it is, under the fee. */
  reason?: string
  /** "edited by the Accountant on 11 Nov · …" after a fee edit by hand. */
  edited?: string
  /** The share before the first edit by hand, for Back to automatic. */
  auto?: number
  paid?: number
  /** Students in one sibling group share a key. */
  group?: string
  /** Marked to pay the full fee in the group. */
  full?: boolean
  /** Sent from the Admission form and not checked in yet: no fee, and the sheet offers check-in. */
  fromForm?: boolean
}

export const SHEET_APPLICANTS: SheetApplicant[] = [
  {
    name: "Zuhura Ali Mussa Khamis",
    number: "DMSN-90009",
    cls: "STD 3",
    custodian: "Ali Mussa Khamis",
    status: "Enrolled",
    next: "Nothing to do",
    relationship: "Father",
    school: "Example Primary School · Public · Tanga",
    broughtBy: "Ali Mussa Khamis",
    sibling: "Sibling group with Khalid Ali Mussa Khamis, who is marked to pay the full fee and has not enrolled.",
    share: 0.1,
    reason: "Sibling 10%",
    paid: 540000,
    group: "ZK",
  },
  {
    name: "Khalid Ali Mussa Khamis",
    number: "DMSN-90010",
    cls: "FORM 2",
    custodian: "Ali Mussa Khamis",
    status: "Visited",
    next: "Collect the interview fee",
    relationship: "Father",
    school: "Mfano Secondary School · Private · Tanga",
    broughtBy: "Ali Mussa Khamis",
    sibling: "Sibling group with Zuhura Ali Mussa Khamis. Pays the full fee: the highest fee.",
    group: "ZK",
    full: true,
  },
  {
    name: "Rehema Said Abdallah",
    number: "DMSN-90004",
    cls: "FORM 1",
    custodian: "Said Abdallah Omar",
    status: "Visited",
    next: "Collect the interview fee",
    relationship: "Father",
    school: "not-known",
    broughtBy: "Said Abdallah Omar",
    sibling: "On their own. No sibling discount.",
  },
  { name: "Fatuma Hamad Seif", number: "DMSN-90008", cls: "DAY CARE", custodian: "Hamad Seif Fatawi", status: "Applied", next: "Check in at the desk", fromForm: true },
]

/** The year's fee for a class (prototype, `FEE`). These amounts are examples. */
export function feeFor(cls: string) {
  const fixed: Record<string, number> = { "DAY CARE": 1200000, "KG 1": 1400000, "KG 2": 1400000 }
  if (fixed[cls]) return fixed[cls]
  if (cls.startsWith("STD")) return Number(cls.slice(4)) < 5 ? 1800000 : 2000000
  return 2600000
}

/** The previous school is asked from STD 2. */
export const NO_SCHOOL_ASKED = ["DAY CARE", "KG 1", "KG 2", "STD 1"]

export const REGIONS = [
  "Dar es Salaam", "Pwani", "Morogoro", "Dodoma", "Arusha", "Mwanza", "Tanga", "Outside Tanzania", "Geita", "Iringa", "Kagera", "Katavi", "Kigoma",
  "Kilimanjaro", "Lindi", "Manyara", "Mara", "Mbeya", "Mtwara", "Njombe", "Rukwa", "Ruvuma", "Shinyanga", "Simiyu", "Singida", "Songwe", "Tabora",
  "Kaskazini Unguja", "Kusini Unguja", "Mjini Magharibi", "Kaskazini Pemba", "Kusini Pemba",
]

export const FEE_CHOICES = ["Full fee", "Sibling 10%", "Back to automatic"]
export const FEE_REASONS = ["Full-fee sibling did not enrol", "Sibling proof after enrolment", "Data-entry correction"]

/** The bell's new requests (prototype, `NOTIF`). */
export const NEW_REQUESTS = [
  { title: "New discount request", caption: "Latifa Omari Juma Hassan · Sibling 10% · names don’t match", icon: "discounts" },
  { title: "New reopening request", caption: "Juma Khamis Ali · family moved back to the area", icon: "reopen" },
] as const
