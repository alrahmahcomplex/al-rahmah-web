import type { Language } from "@/lib/language"

// The words of "Umesahau nenosiri?", the shared reset page and the
// expired-link panel (#194, #265), in Swahili and English, for staff and
// Discount code holders alike. Like the Discount code pages they never say
// agent, referral or Wakala. A native Swahili reader checks the Swahili
// before it ships.

export type LinkRequestStatus = "sent" | "invalid-email" | "check-pending" | "check-failed" | "rate-limited" | "unavailable"

type Copy = {
  forgotHeading: string
  forgotIntro: string
  expiredHeading: string
  expiredIntro: string
  resetHeading: string
  resetIntro: string
  email: string
  send: string
  sending: string
  // The reset page, while this browser is signed in to any account.
  signedIn: { text: string }
  // The same reply whether or not the email has an account, or whose it is.
  sent: string
  messages: Record<Exclude<LinkRequestStatus, "sent">, { text: string; code?: string }>
  fallback: string
  callOffice: string
  goToSignIn: string
}

export const LINK_REQUEST_COPY: Record<Language, Copy> = {
  sw: {
    forgotHeading: "Umesahau nenosiri?",
    forgotIntro: "Andika barua pepe unayoitumia kuingia. Tutakutumia kiungo cha kuweka nenosiri jipya.",
    expiredHeading: "Kiungo kimeisha muda",
    expiredIntro: "Kiungo hiki kimeisha muda au kimeshatumika. Andika barua pepe yako, tukutumie kiungo kipya.",
    resetHeading: "Weka nenosiri jipya",
    resetIntro: "Utalitumia pamoja na barua pepe yako kuingia.",
    email: "Barua pepe",
    send: "Tuma kiungo kipya",
    sending: "Inatuma…",
    signedIn: { text: "Kivinjari hiki kimeingia kwenye akaunti. Toka kwanza, kisha uweke nenosiri jipya." },
    sent: "Kama barua pepe hii ina akaunti, tumeitumia kiungo. Angalia barua pepe zako, pamoja na spam. Kiungo kinatumika mara moja tu, ndani ya saa 24.",
    messages: {
      "invalid-email": { text: "Andika barua pepe yako, mfano jina@mfano.com." },
      "check-pending": { text: "Subiri ukaguzi wa usalama ukamilike, kisha utume." },
      "check-failed": { text: "Ukaguzi wa usalama haukukamilika. Jaribu tena." },
      "rate-limited": { text: "Maombi ni mengi mno. Subiri kidogo kisha ujaribu tena, au piga simu ofisini.", code: "rate_limited" },
      unavailable: { text: "Huduma haipatikani kwa sasa. Jaribu tena baada ya muda mfupi.", code: "unavailable" },
    },
    fallback: "Bado unahitaji msaada?",
    callOffice: "Piga simu ofisini",
    goToSignIn: "Nenda kuingia",
  },
  en: {
    forgotHeading: "Forgot your password?",
    forgotIntro: "Type the email you sign in with. We'll send you a link to set a new password.",
    expiredHeading: "This link has expired",
    expiredIntro: "This link has expired or was already used. Type your email and we'll send you a new one.",
    resetHeading: "Set a new password",
    resetIntro: "You'll use it with your email to sign in.",
    email: "Email",
    send: "Send a new link",
    sending: "Sending…",
    signedIn: { text: "This browser is signed in to an account. Sign out first, then set the new password." },
    sent: "If this email has an account, we've sent it a link. Check your email, including spam. The link works once, within 24 hours.",
    messages: {
      "invalid-email": { text: "Enter your email, for example name@example.com." },
      "check-pending": { text: "Wait a moment for the security check to finish, then send." },
      "check-failed": { text: "The security check didn't finish. Try again." },
      "rate-limited": { text: "Too many requests. Wait a little, then try again, or call the office.", code: "rate_limited" },
      unavailable: { text: "The service isn't available right now. Try again in a moment.", code: "unavailable" },
    },
    fallback: "Still need help?",
    callOffice: "Call the office",
    goToSignIn: "Go to sign-in",
  },
}
