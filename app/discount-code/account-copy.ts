import type { Language } from "@/lib/language"
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"
import type { AcceptAgentInviteError, AgentSignInError, AgentUserError } from "@/lib/services/agent-auth"

// The words of the Discount code account pages (#191), in Swahili and
// English. Like the Discount code page, they never say agent, referral or
// Wakala. A native Swahili reader checks the Swahili before it ships.
//
// A refusal a person may need to read out on the phone carries a short
// reason code.

export type AccountMessage = { text: string; code?: string; signIn?: boolean; forgot?: boolean }

type MessageKey =
  | AgentSignInError
  | AcceptAgentInviteError
  | AgentUserError
  | "password-mismatch"
  | "invalid-link"

type Copy = {
  title: string
  email: string
  password: string
  showPassword: string
  hidePassword: string
  forgot: string
  helpLine: string
  setPasswordHeading: string
  setPasswordIntro: string
  newPassword: string
  confirmPassword: string
  passwordRule: string
  setPassword: string
  saving: string
  goToSignIn: string
  signOut: string
  reasonCode: (code: string) => string
  messages: Record<MessageKey, AccountMessage>
}

const OFF_SW = "Huwezi kuingia kwa sasa. Piga simu ofisini."
const OFF_EN = "You can't sign in right now. Call the office."
const PAUSED_SW = "Huduma hii imesimamishwa kwa muda."
const PAUSED_EN = "This service is paused for now."
const EXPIRED_SW = "Kiungo hiki kimeisha muda au kimeshatumika. Piga simu ofisini upate kiungo kipya."
const EXPIRED_EN = "This link has expired or was already used. Call the office for a new one."

export const ACCOUNT_COPY: Record<Language, Copy> = {
  sw: {
    title: "Code ya Punguzo",
    email: "Barua pepe",
    password: "Nenosiri",
    showPassword: "Onyesha nenosiri",
    hidePassword: "Ficha nenosiri",
    forgot: "Umesahau nenosiri?",
    helpLine: "Huenda bado tunathibitisha code yako au barua pepe yako.",
    setPasswordHeading: "Weka nenosiri lako",
    setPasswordIntro: "Utalitumia pamoja na barua pepe yako kuingia kwenye kurasa za Code ya Punguzo.",
    newPassword: "Nenosiri jipya",
    confirmPassword: "Rudia nenosiri jipya",
    passwordRule: `Angalau herufi ${MINIMUM_PASSWORD_LENGTH}.`,
    setPassword: "Weka nenosiri",
    saving: "Inahifadhi…",
    goToSignIn: "Nenda kuingia",
    signOut: "Toka",
    reasonCode: (code) => `Msimbo: ${code}`,
    messages: {
      "invalid-credentials": { text: "Barua pepe au nenosiri si sahihi.", forgot: true },
      "rate-limited": { text: "Majaribio ni mengi mno. Subiri dakika chache, kisha ujaribu tena.", code: "rate_limited" },
      banned: { text: OFF_SW, code: "banned" },
      "staff-session": { text: "Kivinjari hiki kimeingia kama mfanyakazi. Toka kwanza." },
      "not-agent": { text: "Akaunti hii si ya Code ya Punguzo.", signIn: true },
      "switched-off": { text: OFF_SW, code: "switched_off" },
      retired: { text: OFF_SW, code: "retired" },
      "access-off": { text: PAUSED_SW, code: "access_off" },
      unavailable: { text: "Huduma haipatikani kwa sasa. Jaribu tena baada ya muda mfupi.", code: "unavailable" },
      "signed-out": { text: "Ingia kwanza." },
      "password-too-short": { text: `Tumia angalau herufi ${MINIMUM_PASSWORD_LENGTH}.` },
      "password-mismatch": { text: "Manenosiri mawili hayafanani." },
      "invalid-link": { text: EXPIRED_SW, code: "invalid_link" },
      "password-not-saved": { text: "Nenosiri halikuhifadhiwa. Jaribu tena baada ya muda mfupi. Likishindikana tena, piga simu ofisini upate kiungo kipya." },
      "joined-unavailable": {
        text: "Nenosiri lako limewekwa, lakini huduma haipatikani kwa sasa. Ingia nalo baada ya muda mfupi.",
        signIn: true,
      },
    },
  },
  en: {
    title: "Discount code",
    email: "Email",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    forgot: "Forgot your password?",
    helpLine: "We may still be checking your code or your email.",
    setPasswordHeading: "Set your password",
    setPasswordIntro: "You'll use it with your email to sign in to the Discount code pages.",
    newPassword: "New password",
    confirmPassword: "Repeat the new password",
    passwordRule: `At least ${MINIMUM_PASSWORD_LENGTH} characters.`,
    setPassword: "Set password",
    saving: "Saving…",
    goToSignIn: "Go to sign-in",
    signOut: "Sign out",
    reasonCode: (code) => `Code: ${code}`,
    messages: {
      "invalid-credentials": { text: "Wrong email or password.", forgot: true },
      "rate-limited": { text: "Too many attempts. Wait a few minutes, then try again.", code: "rate_limited" },
      banned: { text: OFF_EN, code: "banned" },
      "staff-session": { text: "This browser is signed in as staff. Sign out first." },
      "not-agent": { text: "This isn't a Discount code account.", signIn: true },
      "switched-off": { text: OFF_EN, code: "switched_off" },
      retired: { text: OFF_EN, code: "retired" },
      "access-off": { text: PAUSED_EN, code: "access_off" },
      unavailable: { text: "The service isn't available right now. Try again in a moment.", code: "unavailable" },
      "signed-out": { text: "Sign in first." },
      "password-too-short": { text: `Use at least ${MINIMUM_PASSWORD_LENGTH} characters.` },
      "password-mismatch": { text: "The two passwords don't match." },
      "invalid-link": { text: EXPIRED_EN, code: "invalid_link" },
      "password-not-saved": { text: "Your password wasn't saved. Try again in a moment. If it fails again, call the office for a new link." },
      "joined-unavailable": {
        text: "Your password is set, but the service isn't available right now. Sign in with it in a moment.",
        signIn: true,
      },
    },
  },
}

