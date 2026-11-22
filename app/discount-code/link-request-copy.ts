import type { Language } from "@/lib/language"

// The words of "Umesahau nenosiri?", the shared reset page and the
// expired-link panel (#194, #265), in Swahili and English, for staff and
// Discount code holders alike. Like the Discount code pages they never say
// agent, referral or Wakala. A native Swahili reader checks the Swahili
// before it ships.

export type LinkRequestStatus = "sent" | "invalid-email" | "invalid-login" | "check-pending" | "check-failed" | "rate-limited" | "unavailable"

type Copy = {
  forgotHeading: string
  forgotIntro: string
  expiredHeading: string
  expiredIntro: string
  resetHeading: string
  resetIntro: string
  email: string
  // "Umesahau nenosiri?" takes an email or a mobile number since #503.
  login: string
  // The reset by SMS (#503 slice 2b, prototype F2 and F3).
  sms: {
    heading: string
    sent: string
    number: string
    digit: (n: number) => string
    sendAgainIn: string
    sendAgain: string
    wrong: string
    tryAgain: string
    expired: string
    sendNew: string
    passwordIntro: string
  }
  send: string
  // The forgot page's button, for a link or an SMS (#503, prototype F1).
  sendForgot: string
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
    forgotIntro: "Andika barua pepe au namba ya simu unayoitumia kuingia. Tutakutumia kiungo, au SMS yenye namba ya kuthibitisha.",
    expiredHeading: "Kiungo kimeisha muda",
    expiredIntro: "Kiungo hiki kimeisha muda au kimeshatumika. Andika barua pepe yako, tukutumie kiungo kipya.",
    resetHeading: "Weka nenosiri jipya",
    resetIntro: "Utalitumia pamoja na barua pepe yako kuingia.",
    email: "Barua pepe",
    login: "Barua pepe au namba ya simu",
    sms: {
      heading: "Angalia SMS yako",
      sent: "Kama namba hii ina akaunti, tumeitumia SMS yenye namba ya kuthibitisha.",
      number: "Namba ya kuthibitisha",
      digit: (n) => `Tarakimu ${n} kati ya 6`,
      sendAgainIn: "Tuma tena baada ya",
      sendAgain: "Tuma tena",
      wrong: "Namba hii si sahihi. Ihakiki, kisha ujaribu tena.",
      tryAgain: "Jaribu tena",
      expired: "Namba hii imepitwa na muda. Tuma mpya.",
      sendNew: "Tuma namba mpya",
      passwordIntro: "Utalitumia pamoja na namba yako ya simu kuingia kwenye kurasa za Code ya Punguzo.",
    },
    send: "Tuma kiungo kipya",
    sendForgot: "Tuma",
    sending: "Inatuma…",
    signedIn: { text: "Kivinjari hiki kimeingia kwenye akaunti. Toka kwanza, kisha uweke nenosiri jipya." },
    sent: "Kama barua pepe hii ina akaunti, tumeitumia kiungo. Angalia barua pepe zako, pamoja na spam. Kiungo kinatumika mara moja tu, ndani ya saa 24.",
    messages: {
      "invalid-email": { text: "Andika barua pepe yako, mfano jina@mfano.com." },
      "invalid-login": { text: "Andika barua pepe, au namba ya simu kama 0712 345 678.", code: "invalid_login" },
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
    forgotIntro: "Type the email or mobile number you sign in with. We'll send you a link, or an SMS with a confirmation number.",
    expiredHeading: "This link has expired",
    expiredIntro: "This link has expired or was already used. Type your email and we'll send you a new one.",
    resetHeading: "Set a new password",
    resetIntro: "You'll use it with your email to sign in.",
    email: "Email",
    login: "Email or mobile number",
    sms: {
      heading: "Check your SMS",
      sent: "If this number has an account, we've texted it a confirmation number.",
      number: "Confirmation number",
      digit: (n) => `Digit ${n} of 6`,
      sendAgainIn: "Send again in",
      sendAgain: "Send again",
      wrong: "That number isn't right. Check it, then try again.",
      tryAgain: "Try again",
      expired: "This number has expired. Send a new one.",
      sendNew: "Send a new number",
      passwordIntro: "You'll use it with your mobile number to sign in to the Discount code pages.",
    },
    send: "Send a new link",
    sendForgot: "Send",
    sending: "Sending…",
    signedIn: { text: "This browser is signed in to an account. Sign out first, then set the new password." },
    sent: "If this email has an account, we've sent it a link. Check your email, including spam. The link works once, within 24 hours.",
    messages: {
      "invalid-email": { text: "Enter your email, for example name@example.com." },
      "invalid-login": { text: "Type an email, or a mobile number like 0712 345 678.", code: "invalid_login" },
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
