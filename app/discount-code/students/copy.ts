import type { Language } from "@/lib/language"
import type { AgentStudent, AgentStudentStatus } from "@/lib/services/agent-students"

// The words of the students list on the Discount code pages (#195), Swahili
// first. Like the other Discount code pages they never say agent, referral or
// Wakala. The status labels and Declined reasons wait for the owner's
// approval on the PR; a native Swahili reader checks the Swahili before it
// ships.

type Copy = {
  heading: (code: string, total: number) => string
  statuses: Record<AgentStudentStatus, string>
  notActive: string
  lastChange: (date: string) => string
  declinedReasons: Record<string, string>
  result: (outcome: "Passed" | "Failed", score: number) => string
  resultPending: string
  searchLabel: string
  search: string
  showAll: string
  noMatch: string
  more: string
  emptyText: string
  helpLine: string
}

export const STUDENTS_COPY: Record<Language, Copy> = {
  sw: {
    heading: (code, total) => `Wanafunzi wanaotumia Code ya Punguzo ${code} (${total})`,
    statuses: {
      Applied: "Amejisajili",
      Visited: "Ametembelea shule",
      Interviewed: "Amefanya usaili",
      Enrolled: "Amejiunga na shule",
      Declined: "Hakuendelea",
    },
    notActive: "haendelei kwa sasa",
    lastChange: (date) => `Imebadilika mwisho: ${date}`,
    declinedReasons: {
      "Enrolled elsewhere": "Amejiunga shule nyingine",
      "Family changed plans": "Familia imebadilisha mipango",
      "Fees or cost": "Ada au gharama",
      "Fee payment not completed": "Malipo ya ada hayakukamilika",
      "No seat available": "Hakuna nafasi",
      "Did not pass interview": "Hakufaulu usaili",
      "Unreachable after follow-up": "Hakupatikana baada ya kufuatiliwa",
      "School decision": "Uamuzi wa shule",
      Other: "Sababu nyingine",
    },
    result: (outcome, score) => `Usaili: ${outcome === "Passed" ? "Amefaulu" : "Hakufaulu"}, alama ${score}%`,
    resultPending: "Matokeo bado hayajatoka",
    searchLabel: "Tafuta kwa jina la mwanafunzi",
    search: "Tafuta",
    showAll: "Onyesha wote",
    noMatch: "Hakuna mwanafunzi mwenye jina hilo.",
    more: "Onyesha zaidi",
    emptyText:
      "Bado hakuna mwanafunzi anayetumia code yako. Familia itaonekana hapa mara code yako itakapowekwa kwenye maombi ya mtoto wao. Shiriki code na kiungo chako:",
    helpLine: "Huoni familia? Waombe wahakikishe walitumia code yako, au piga simu ofisini.",
  },
  en: {
    heading: (code, total) => `Students using Discount code ${code} (${total})`,
    statuses: {
      Applied: "Applied",
      Visited: "Visited",
      Interviewed: "Interviewed",
      Enrolled: "Enrolled",
      Declined: "Declined",
    },
    notActive: "not active",
    lastChange: (date) => `Last change: ${date}`,
    declinedReasons: {
      "Enrolled elsewhere": "Enrolled elsewhere",
      "Family changed plans": "Family changed plans",
      "Fees or cost": "Fees or cost",
      "Fee payment not completed": "Fee payment not completed",
      "No seat available": "No seat available",
      "Did not pass interview": "Did not pass interview",
      "Unreachable after follow-up": "Unreachable after follow-up",
      "School decision": "School decision",
      Other: "Other",
    },
    result: (outcome, score) => `Interview: ${outcome}, score ${score}%`,
    resultPending: "Results aren't out yet",
    searchLabel: "Search by the student's name",
    search: "Search",
    showAll: "Show all",
    noMatch: "No student has that name.",
    more: "Show more",
    emptyText:
      "No student is using your code yet. A family shows here once your code is on their child's application. Share your code and link:",
    helpLine: "Don't see a family? Ask them to check they used your code, or call the office.",
  },
}

// The date as the agent reads it, from the database's YYYY-MM-DD.
export function formatChangeDate(date: string, language: Language): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Intl.DateTimeFormat(language === "sw" ? "sw-TZ" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

// The lines of one card, below the name: the status (with "not active" when
// a closure mark is set), the Declined reason, the interview line and the
// date of the last change.
export function cardLines(student: AgentStudent, language: Language): string[] {
  const copy = STUDENTS_COPY[language]
  const status = copy.statuses[student.status]
  const lines = [student.notActive ? `${status} · ${copy.notActive}` : status]
  if (student.declinedReason) lines.push(copy.declinedReasons[student.declinedReason] ?? student.declinedReason)
  if (student.result) lines.push(copy.result(student.result.outcome, student.result.score))
  else if (student.interviewRegistered) lines.push(copy.resultPending)
  lines.push(copy.lastChange(formatChangeDate(student.lastChange, language)))
  return lines
}

export const PAGE_SIZE = 20
// The function's largest page. Past it, the agent searches by name.
export const MAX_SHOWN = 200

// How many rows the address asks to show: a whole number of pages, from one
// page up to MAX_SHOWN.
export function shownFrom(value: string | string[] | undefined): number {
  const parsed = Number(typeof value === "string" ? value : "")
  if (!Number.isInteger(parsed) || parsed < PAGE_SIZE) return PAGE_SIZE
  return Math.min(MAX_SHOWN, Math.ceil(parsed / PAGE_SIZE) * PAGE_SIZE)
}
