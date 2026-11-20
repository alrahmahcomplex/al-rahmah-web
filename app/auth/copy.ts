import type { Language } from "@/lib/language"
import type { SignInError } from "@/lib/services/sign-in"

// The words of the one sign-in page (#264), for staff and Discount code
// holders, in Swahili and English. Like the Discount code pages they never
// say agent or Wakala; the note for an agent coming from the students page is
// the owner's wording, "the students you referred" (#497). A native Swahili
// reader checks the Swahili before it ships.

// Problems /auth shows from the address, after a redirect: an expired email
// link (/auth/callback) or a session the staff side refused (app/staff/session.ts).
export const LOGIN_NOTICES = ["invalid-link", "not-staff", "deactivated", "unavailable"] as const
export type LoginNotice = (typeof LOGIN_NOTICES)[number]

// `forgot` puts the reset link under the message. `code` names the reason
// for logs and tests; the form never prints it (#497).
export type LoginMessage = { text: string; code?: string; forgot?: boolean }

type Copy = {
  title: string
  welcome: string
  email: string
  password: string
  showPassword: string
  hidePassword: string
  logIn: string
  processing: string
  forgot: string
  // Above the form for a Discount code holder sent from the students page (#497 state 5).
  studentsNote: string
  messages: Record<SignInError | LoginNotice, LoginMessage>
}

const OFF_SW = "Huwezi kuingia kwa sasa. Piga simu ofisini."
const OFF_EN = "You can't sign in right now. Call the office."
// A paused or closed Discount code says what the students page says (#497
// state 6, decision 58), then where to turn.
const PAUSED_SW = "Ofisi ya Masoko imesimamisha Code yako ya Punguzo kwa sasa. Piga simu ofisini."
const PAUSED_EN = "The Marketing Office has paused your Discount code for now. Call the office."
const CLOSED_SW = "Ofisi ya Masoko imefunga Code hii ya Punguzo. Piga simu ofisini."
const CLOSED_EN = "The Marketing Office has closed this Discount code. Call the office."

export const LOGIN_COPY: Record<Language, Copy> = {
  sw: {
    title: "Ingia",
    welcome: "Karibu!",
    email: "Barua pepe",
    password: "Nenosiri",
    showPassword: "Onyesha nenosiri",
    hidePassword: "Ficha nenosiri",
    logIn: "Ingia",
    processing: "Inaingia…",
    forgot: "Umesahau nenosiri?",
    studentsNote: "Ingia uone wanafunzi uliowaleta.",
    messages: {
      "invalid-credentials": { text: "Barua pepe au nenosiri si sahihi.", forgot: true },
      "rate-limited": { text: "Majaribio ni mengi mno. Subiri dakika chache, kisha ujaribu tena.", code: "rate_limited" },
      banned: { text: OFF_SW, code: "banned" },
      "check-pending": { text: "Subiri ukaguzi wa usalama ukamilike, kisha uingie." },
      "check-failed": { text: "Ukaguzi wa usalama haukukamilika. Jaribu tena.", code: "captcha_failed" },
      unavailable: { text: "Huduma haipatikani kwa sasa. Jaribu tena baada ya muda mfupi.", code: "unavailable" },
      deactivated: { text: "Akaunti yako ya mfanyakazi imezimwa. Mwombe anayesimamia akaunti yako aiwashe tena.", code: "deactivated" },
      "not-staff": { text: "Akaunti hii haipo kwenye orodha ya wafanyakazi. Mwombe anayesimamia wafanyakazi akualike.", code: "not_staff" },
      "switched-off": { text: PAUSED_SW, code: "switched_off" },
      retired: { text: CLOSED_SW, code: "retired" },
      "access-off": { text: "Tumesimamisha kurasa hizi kwa kila mtu kwa muda. Code yako haijaathirika.", code: "access_off" },
      "no-account": { text: "Akaunti hii haiwezi kuingia hapa. Piga simu ofisini.", code: "no_account" },
      "invalid-link": { text: "Kiungo hiki si sahihi au kimeisha muda.", code: "invalid_link" },
    },
  },
  en: {
    title: "Sign in",
    welcome: "Welcome!",
    email: "Email",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    logIn: "Log In",
    processing: "Processing...",
    forgot: "Forgot your password?",
    studentsNote: "Sign in to see the students you referred.",
    messages: {
      "invalid-credentials": { text: "Wrong email or password.", forgot: true },
      "rate-limited": { text: "Too many sign-in attempts. Wait a few minutes, then try again.", code: "rate_limited" },
      banned: { text: OFF_EN, code: "banned" },
      "check-pending": { text: "Wait a moment for the security check to finish, then sign in." },
      "check-failed": { text: "The security check didn't finish. Try again.", code: "captcha_failed" },
      unavailable: { text: "Sign-in is unavailable right now. Try again in a moment.", code: "unavailable" },
      deactivated: { text: "Your staff account is deactivated. Ask whoever manages your account to reactivate it.", code: "deactivated" },
      "not-staff": { text: "This account is not on the staff list. Ask whoever manages staff to invite you.", code: "not_staff" },
      "switched-off": { text: PAUSED_EN, code: "switched_off" },
      retired: { text: CLOSED_EN, code: "retired" },
      "access-off": { text: "We've paused these pages for everyone for a while. Your code isn't affected.", code: "access_off" },
      "no-account": { text: "This account can't sign in here. Call the office.", code: "no_account" },
      "invalid-link": { text: "That sign-in link is invalid or has expired.", code: "invalid_link" },
    },
  },
}
