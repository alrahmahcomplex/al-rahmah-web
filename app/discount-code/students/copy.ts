import type { Language } from "@/lib/language"
import type { AgentStudent, AgentStudentStatus, ReminderStep } from "@/lib/services/agent-students"

// The words of the agent's students page on the Discount code pages (#195):
// the dashboard of prototype v47 (#497, the owner's pick B), Swahili first.
// They never say agent or Wakala. The dashboard's words (D-N numbers in the
// prototype) and the reminders are the owner's, checked in Swahili.

type Copy = {
  // "Habari, Amina!" over the page, with the code under it.
  hello: (firstName: string) => string
  yourCode: string
  // Opens the message picker; the picker's own words.
  shareCode: string
  pickMessage: string
  messages: { parent: string; group: string; short: string }
  copyMessage: string
  messageCopied: string
  close: string
  // The count per step, and who could use a reminder.
  whereFamilies: string
  remindHeading: (count: number) => string
  // Under the first five reminders, to show them all (decision 67).
  seeAllReminders: (count: number) => string
  waiting: Record<ReminderStep, (days: number) => string>
  prepare: string
  reminderTitle: string
  // The reminder itself: the student's first name and the office's number.
  reminder: Record<ReminderStep, (firstName: string, office: string) => string>
  openWhatsApp: string
  // The step filter's first chip.
  all: string
  // With no students yet, above the message picker.
  emptyNote: string
  // Once, right after the password is set (state 4): the title and the line
  // above the button on to the list.
  approved: string
  // O-N17, after self-confirm (#503).
  ready: string
  signedInNote: string
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
  searchForMore: string
  helpLine: string
}

export const STUDENTS_COPY: Record<Language, Copy> = {
  sw: {
    hello: (firstName) => `Habari, ${firstName}!`,
    yourCode: "Code yako",
    shareCode: "Shiriki code yako",
    pickMessage: "Chagua ujumbe",
    messages: { parent: "Kwa mzazi", group: "Kwa kikundi", short: "Fupi" },
    copyMessage: "Nakili ujumbe",
    messageCopied: "Ujumbe umenakiliwa",
    close: "Funga",
    whereFamilies: "Familia zako ziko wapi",
    remindHeading: (count) => `Wanaweza kukumbushwa (${count})`,
    seeAllReminders: (count) => `Ona wote (${count})`,
    waiting: {
      Applied: (days) => `Alijisajili siku ${days} zilizopita, bado hajatembelea shule.`,
      Visited: (days) => `Alitembelea siku ${days} zilizopita, bado hajafanya usaili.`,
      Interviewed: (days) => `Alifaulu usaili siku ${days} zilizopita, bado hajajiunga.`,
    },
    prepare: "Andaa ujumbe",
    reminderTitle: "Ujumbe wa kukumbusha",
    reminder: {
      Applied: (name, office) =>
        `Habari! Hongera kwa kumsajili ${name} Al-Rahmah Complex. Karibuni mtembelee shule muone mazingira. Kwa maswali, piga ofisi ya udahili: ${office}.`,
      Visited: (name, office) =>
        `Habari! Asante kwa kutembelea Al-Rahmah Complex na ${name}. Hatua inayofuata ni usaili. Piga ofisi ya udahili kujua siku: ${office}.`,
      Interviewed: (name, office) =>
        `Habari! Hongera, ${name} amefaulu usaili Al-Rahmah Complex! Hatua inayofuata ni kukamilisha usajili. Piga ofisi ya udahili: ${office}.`,
    },
    openWhatsApp: "Fungua WhatsApp",
    all: "Wote",
    approved: "Umeidhinishwa!",
    ready: "Akaunti yako iko tayari!",
    signedInNote: "Umeingia. Gusa kitufe hapa chini uone wanafunzi wote uliowaleta.",
    emptyNote: "Familia ikitumia code yako, utaona hapa kila hatua yake: kujisajili, kutembelea shule, usaili na kujiunga.",
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
    searchForMore: "Tafuta kwa jina kuona wanafunzi wengine.",
    helpLine: "Huoni familia? Waombe wahakikishe walitumia code yako, au piga simu ofisini.",
  },
  en: {
    hello: (firstName) => `Hello, ${firstName}!`,
    yourCode: "Your code",
    shareCode: "Share your code",
    pickMessage: "Pick a message",
    messages: { parent: "To a parent", group: "To a group", short: "Short" },
    copyMessage: "Copy message",
    messageCopied: "Message copied",
    close: "Close",
    whereFamilies: "Where your families are",
    remindHeading: (count) => `Could use a reminder (${count})`,
    seeAllReminders: (count) => `See all (${count})`,
    waiting: {
      Applied: (days) => `Applied ${days} days ago, hasn't visited yet.`,
      Visited: (days) => `Visited ${days} days ago, no interview yet.`,
      Interviewed: (days) => `Passed the interview ${days} days ago, not enrolled yet.`,
    },
    prepare: "Prepare a message",
    reminderTitle: "Reminder message",
    reminder: {
      Applied: (name, office) =>
        `Hello! Well done on applying for ${name} at Al-Rahmah Complex. You're welcome to visit the school and see it for yourselves. For questions, call the admissions office: ${office}.`,
      Visited: (name, office) =>
        `Hello! Thank you for visiting Al-Rahmah Complex with ${name}. The next step is the interview. Call the admissions office to find out when: ${office}.`,
      Interviewed: (name, office) =>
        `Hello! Congratulations, ${name} passed the interview at Al-Rahmah Complex! The next step is to complete enrollment. Call the admissions office: ${office}.`,
    },
    openWhatsApp: "Open WhatsApp",
    all: "All",
    approved: "You're approved!",
    ready: "Your account is ready!",
    signedInNote: "You're signed in. Tap the button below to see all the students you referred.",
    emptyNote: "When a family uses your code, you'll see each step here: applying, visiting the school, the interview and enrolling.",
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
    searchForMore: "Search by name to find the other students.",
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

// A name's first word as people write it ("REHEMA ALI" reads "Rehema"), for
// the greeting and the reminders.
export function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? ""
  return first.charAt(0).toLocaleUpperCase("en") + first.slice(1).toLocaleLowerCase("en")
}

// The step a ?step= address asks for, or null for every step.
export function stepFrom(value: string | string[] | undefined): AgentStudentStatus | null {
  const steps: AgentStudentStatus[] = ["Applied", "Visited", "Interviewed", "Enrolled", "Declined"]
  return steps.find((step) => step === value) ?? null
}
