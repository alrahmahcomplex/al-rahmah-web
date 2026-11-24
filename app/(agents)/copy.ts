import { ACCOUNT_COPY } from "@/app/discount-code/account-copy"
import { COPY as DISCOUNT_COPY, discountWords } from "@/app/discount-code/copy"
import { firstName, MAX_SHOWN, PAGE_SIZE, shownFrom, stepFrom, STUDENTS_COPY } from "@/app/discount-code/students/copy"
import type { Language } from "@/lib/language"
import type { AgentStudentStatus, ReminderStep } from "@/lib/services/agent-students"

export { ACCOUNT_COPY, DISCOUNT_COPY, discountWords, firstName, MAX_SHOWN, PAGE_SIZE, shownFrom, stepFrom, STUDENTS_COPY }

// Copy specific to the agents app (#539, prototype v5, A-N1..A-N27). Never
// says "agent" or "Wakala". Reuses STUDENTS_COPY, DISCOUNT_COPY and
// ACCOUNT_COPY for everything shared with the Discount code pages.

type AgentsCopy = {
  navHome: string
  navStudents: string
  codeTitle: string
  menu: string
  language: string
  back: string
  topSearch: string
  filter: string
  resultsFor: (query: string) => string
  profileTitle: string
  fullName: string
  mobile: string
  classLabel: string
  interviewLabel: string
  changedLabel: string
  resultValue: (outcome: "Passed" | "Failed", score: number) => string
  remindLine: Record<ReminderStep, string>
  remindPage: string
  stepNow: string
  copySms: string
  smsCopied: string
  outQuestion: string
  outBody: string
  stay: string
  allApplied: string
  shareWa: string
  newsTitle: string
  noNews: string
  ago: (days: number) => string
  notFoundTitle: string
  notFoundHint: string
  backToStudents: string
}

export const AGENTS_COPY: Record<Language, AgentsCopy> = {
  sw: {
    navHome: "Nyumbani",
    navStudents: "Wanafunzi",
    codeTitle: "Code ya Punguzo",
    menu: "Menyu",
    language: "Lugha",
    back: "Rudi",
    topSearch: "Tafuta mwanafunzi",
    filter: "Chuja",
    resultsFor: (q) => `Matokeo ya “${q}”`,
    profileTitle: "Wasifu wako",
    fullName: "Jina kamili",
    mobile: "Namba ya simu",
    classLabel: "Darasa",
    interviewLabel: "Usaili",
    changedLabel: "Imebadilika mwisho",
    resultValue: (outcome, score) => `${outcome === "Passed" ? "Amefaulu" : "Hakufaulu"} · alama ${score}%`,
    remindLine: {
      Applied: "Mkumbushe mzazi kuhusu usaili.",
      Visited: "Mkumbushe mzazi kuhusu usaili.",
      Interviewed: "Mkumbushe mzazi amalize kujiunga.",
    },
    remindPage: "Wanaweza kukumbushwa",
    stepNow: "Hatua ya sasa",
    copySms: "Nakili ujumbe wa SMS",
    smsCopied: "Ujumbe umenakiliwa. Utume kwa SMS kutoka simu yako.",
    outQuestion: "Utoke kwenye akaunti?",
    outBody: "Utaingia tena kwa namba yako au barua pepe na nenosiri.",
    stay: "Baki",
    allApplied: "Waliojisajili wote",
    shareWa: "Shiriki code kwenye WhatsApp",
    newsTitle: "Mabadiliko mapya",
    noNews: "Hakuna mabadiliko mapya katika siku 7 zilizopita.",
    ago: (days) => (days <= 0 ? "Leo" : days === 1 ? "Jana" : `Siku ${days} zilizopita`),
    notFoundTitle: "Mwanafunzi huyu hajapatikana",
    notFoundHint: "Huenda kiungo si sahihi au hakihusu orodha yako.",
    backToStudents: "Rudi kwa wanafunzi",
  },
  en: {
    navHome: "Home",
    navStudents: "Students",
    codeTitle: "Discount code",
    menu: "Menu",
    language: "Language",
    back: "Back",
    topSearch: "Search a student",
    filter: "Filter",
    resultsFor: (q) => `Results for “${q}”`,
    profileTitle: "Your profile",
    fullName: "Full name",
    mobile: "Mobile number",
    classLabel: "Class",
    interviewLabel: "Interview",
    changedLabel: "Last change",
    resultValue: (outcome, score) => `${outcome} · score ${score}%`,
    remindLine: {
      Applied: "Remind the family about the interview.",
      Visited: "Remind the family about the interview.",
      Interviewed: "Remind the family to finish enrolment.",
    },
    remindPage: "Could use a reminder",
    stepNow: "Step now",
    copySms: "Copy the SMS message",
    smsCopied: "Message copied. Send it by SMS from your phone.",
    outQuestion: "Sign out?",
    outBody: "You will sign in again with your mobile number or email and password.",
    stay: "Stay",
    allApplied: "All who applied",
    shareWa: "Share your code on WhatsApp",
    newsTitle: "What’s new",
    noNews: "No changes in the last 7 days.",
    ago: (days) => (days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`),
    notFoundTitle: "Student not found",
    notFoundHint: "That link may be wrong or not on your list.",
    backToStudents: "Back to students",
  },
}

export const PROGRESS_STEPS: readonly AgentStudentStatus[] = ["Applied", "Visited", "Interviewed", "Enrolled"]

export function formatTanzaniaDate(isoDate: string, language: Language): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  if (!y || !m || !d) return isoDate
  return new Intl.DateTimeFormat(language === "sw" ? "sw-TZ" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function whatsAppHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
