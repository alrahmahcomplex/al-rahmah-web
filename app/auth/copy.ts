import type { Language } from "@/lib/language"
import type { SignInError } from "@/lib/services/sign-in"
import { AGENTS_HOST, PORTAL_HOST } from "@/lib/site-hosts"

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
  // Since #503 the field takes an email or a mobile number.
  login: string
  password: string
  showPassword: string
  hidePassword: string
  logIn: string
  processing: string
  forgot: string
  // Above the form for a Discount code holder sent from the students page (#497 state 5).
  studentsNote: string
  // Above the form on agents.alrahmahcomplex.or.tz/auth?from=moved (#539, A-N10).
  movedNote: string
  // Under Forgot password on agents.alrahmahcomplex.or.tz/auth (#539, A-N3).
  noCode: string
  signUp: string
  // Wrong-host sign-in notices (#539, A-N4, A-N5).
  staffHere: string
  openPortal: string
  agentHere: string
  openAgents: string
  // "Your pages have moved" on portal/auth for a signed-in agent (#539, A-N6..A-N9).
  movedTitle: string
  movedTextPrefix: string
  movedTextWithLogin: (maskedLogin: string) => { before: string; login: string; after: string }
  movedTextNoLogin: string
  movedGo: string
  movedTip: string
  signOut: string
  // Reset password saved on the wrong host (#539, A-N11).
  savedMovedAgents: { before: string; host: string; after: string }
  savedMovedPortal: { before: string; host: string; after: string }
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
    login: "Barua pepe au namba ya simu",
    password: "Nenosiri",
    showPassword: "Onyesha nenosiri",
    hidePassword: "Ficha nenosiri",
    logIn: "Ingia",
    processing: "Inaingia…",
    forgot: "Umesahau nenosiri?",
    studentsNote: "Ingia uone wanafunzi uliowaleta.",
    movedNote: "Karibu kwenye anwani mpya! Ingia mara moja ili uendelee.",
    noCode: "Huna Code ya Punguzo bado?",
    signUp: "Jisajili upate code",
    staffHere: `Akaunti hii ni ya mfanyakazi. Wafanyakazi huingia kwenye ${PORTAL_HOST}.`,
    openPortal: "Fungua ukurasa wa wafanyakazi",
    agentHere: `Akaunti hii ina Code ya Punguzo. Kurasa zako sasa ziko ${AGENTS_HOST}.`,
    openAgents: "Nenda kwenye kurasa zako",
    movedTitle: "Kurasa zako zimehamia",
    movedTextPrefix: "Sasa unaona wanafunzi uliowaleta kwenye ",
    movedTextWithLogin: (login) => ({ before: ". Ingia huko mara moja tu kwa ", login, after: " na nenosiri lako la kawaida." }),
    movedTextNoLogin: ". Ingia huko mara moja tu kwa akaunti yako na nenosiri lako la kawaida.",
    movedGo: "Fungua kurasa mpya",
    movedTip: "Ukifika huko, ongeza programu mpya kwenye skrini ya simu yako. Ya zamani unaweza kuiondoa.",
    signOut: "Toka",
    savedMovedAgents: {
      before: "Nenosiri limehifadhiwa. Kurasa zako sasa ziko ",
      host: AGENTS_HOST,
      after: "; ingia huko kwa nenosiri jipya.",
    },
    savedMovedPortal: {
      before: "Nenosiri limehifadhiwa. Wafanyakazi huingia kwenye ",
      host: PORTAL_HOST,
      after: "; ingia huko kwa nenosiri jipya.",
    },
    messages: {
      "invalid-credentials": { text: "Barua pepe, namba ya simu au nenosiri si sahihi.", forgot: true },
      "invalid-login": { text: "Andika barua pepe, au namba ya simu kama 0712 345 678.", code: "invalid_login" },
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
    login: "Email or mobile number",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    logIn: "Log In",
    processing: "Processing...",
    forgot: "Forgot your password?",
    studentsNote: "Sign in to see the students you referred.",
    movedNote: "Welcome to the new address! Sign in once to carry on.",
    noCode: "No Discount code yet?",
    signUp: "Sign up for a code",
    staffHere: `This is a staff account. Staff sign in at ${PORTAL_HOST}.`,
    openPortal: "Open the staff page",
    agentHere: `This account holds a Discount code. Your pages are now at ${AGENTS_HOST}.`,
    openAgents: "Go to your pages",
    movedTitle: "Your pages have moved",
    movedTextPrefix: "You now see the students you referred at ",
    movedTextWithLogin: (login) => ({ before: ". Sign in there once with ", login, after: " and your usual password." }),
    movedTextNoLogin: ". Sign in there once with your usual login and password.",
    movedGo: "Open the new pages",
    movedTip: "Once there, add the new app to your phone’s home screen. You can remove the old one.",
    signOut: "Sign out",
    savedMovedAgents: {
      before: "Password saved. Your pages are now at ",
      host: AGENTS_HOST,
      after: "; sign in there with the new password.",
    },
    savedMovedPortal: {
      before: "Password saved. Staff sign in at ",
      host: PORTAL_HOST,
      after: "; sign in there with the new password.",
    },
    messages: {
      "invalid-credentials": { text: "Wrong email, mobile number or password.", forgot: true },
      "invalid-login": { text: "Type an email, or a mobile number like 0712 345 678.", code: "invalid_login" },
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
