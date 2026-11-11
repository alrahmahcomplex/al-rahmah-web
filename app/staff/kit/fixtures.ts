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
  { name: "Latifa Omari Juma Hassan", kind: "Sibling · 10%", why: "Fathers’ names don’t match", by: "Example Staff One · today 09:20" },
  { name: "Saidi Khamis Mussa Haji", kind: "Sibling · 10%", why: "Fathers’ names don’t match", by: "Example Staff Two · 2 days ago" },
  { name: "Amani Daudi Petro", kind: "Staff child · 25%", why: "Parent works at the school", by: "Example Staff One · yesterday" },
]

export const CAMPUS: { when: string; name: string; about: string; status: LeadStatus; checkIn?: boolean }[] = [
  { when: "Expected", name: "Yusuf and Mariam Ali Hassan", about: "STD 6 and STD 1 · sent the Admission form", status: "Applied", checkIn: true },
  { when: "09:10", name: "Baraka Mfano", about: "FORM 2 · result ready to release", status: "Interviewed" },
]

export const PAYMENT_KINDS = ["Initial deposit", "First instalment", "Second instalment", "Third instalment", "Full payment"]
