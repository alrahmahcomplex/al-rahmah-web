import type { Language } from "@/lib/language"

// The words of self-confirm (#503 slice 3, prototype v58: O-N1 to O-N51), in
// Swahili and English, as the owner checked them on 21 Nov. Like the rest of
// the Discount code pages they never say agent, referral or Wakala.

type Copy = {
  reviewNote: string // O-N1
  chooseTitle: string // O-N29
  chooseIntro: string // O-N30
  byMobile: string // O-N31
  byMobileHint: string // O-N32
  byEmail: string // O-N33
  byEmailHint: string // O-N34
  byEmailOffice: string // W9, prototype v6: the email path is today's claim
  continue: string // O-N36
  smsTitle: string // O-N2
  smsSentTo: string // O-N3, then the masked mobile
  smsToRecord: string // O-N26
  smsNotTyped: string // O-N4
  number: string // O-N5
  digit: (n: number) => string // O-N51
  sendAgainIn: string // O-N7
  sendAgain: string // O-N8
  noSms: string // O-N9
  noSmsHint: string // O-N24
  orEmail: string // O-N50
  useEmail: string // O-N39
  close: string
  wrong: string // O-N19
  triesLeft: string // O-N20
  tryAgain: string // O-N47
  expired: string // O-N23
  sendNew: string // O-N48
  locked: string // O-N28
  mobileUsedTitle: string // O-N37
  mobileUsed: string // O-N38
  emailTitle: string // O-N11
  emailSentTo: string // O-N27, then the email
  spam: string
  changeEmail: string // O-N13
  passwordTitle: string
  passwordIntro: string // O-N40
  signsInWith: string // O-N16
  newPassword: string
  confirmPassword: string
  passwordRule: string
  setPassword: string
  saving: string
  readyTitle: string // O-N17
  emailUnusable: string
  noEmail: string
  limited: string
  unavailable: string
  checkPending: string
  passwordMismatch: string
  passwordTooShort: string
  steps: { choose: string; prove: string; password: string }
}

export const SELF_CONFIRM_COPY: Record<Language, Copy> = {
  sw: {
    reviewNote: "Tunalinganisha code hii na majina yako. Kisha utachagua jinsi ya kuingia, na kuweka nenosiri mwenyewe.",
    chooseTitle: "Chagua jinsi ya kuingia",
    chooseIntro: "Utatumia chaguo hili pamoja na nenosiri lako kila unapoingia.",
    byMobile: "Kwa namba ya simu",
    byMobileHint: "Tutakutumia SMS yenye namba ya kuthibitisha.",
    byEmail: "Kwa barua pepe",
    byEmailHint: "Tutakutumia kiungo cha kuweka nenosiri.",
    byEmailOffice: "Ofisi ya Masoko italithibitisha kwanza, kisha tutakutumia kiungo cha kuweka nenosiri.",
    continue: "Endelea",
    smsTitle: "Angalia SMS yako",
    smsSentTo: "Tumetuma namba ya kuthibitisha yenye tarakimu 6 kwa",
    smsToRecord: "Tumetuma namba ya kuthibitisha yenye tarakimu 6 kwa namba ya simu iliyo kwenye kumbukumbu zetu.",
    smsNotTyped: "Tumeituma kwa namba iliyo kwenye kumbukumbu zetu, si namba uliyoandika. Huna namba hiyo tena? Piga simu ofisini.",
    number: "Namba ya kuthibitisha",
    digit: (n) => `Tarakimu ${n} kati ya 6`,
    sendAgainIn: "Tuma tena baada ya",
    sendAgain: "Tuma tena",
    noSms: "Hujapata SMS?",
    noSmsHint: "Hakikisha simu ina mtandao, kisha tuma tena.",
    orEmail: "Au ingia kwa barua pepe: tutakutumia kiungo cha kuweka nenosiri.",
    useEmail: "Tumia barua pepe",
    close: "Funga",
    wrong: "Namba hii si sahihi. Ihakiki, kisha ujaribu tena.",
    triesLeft: "Umebakiwa na majaribio",
    tryAgain: "Jaribu tena",
    expired: "Namba hii imepitwa na muda. Tuma mpya.",
    sendNew: "Tuma namba mpya",
    locked: "Kwa usalama, tumesimamisha namba za kuthibitisha za code hii. Jaribu tena baada ya dakika 30.",
    mobileUsedTitle: "Namba hii tayari inatumika",
    mobileUsed: "Namba hii ya simu tayari inatumika kuingia kwenye akaunti nyingine, na namba moja ni ya akaunti moja tu. Ingia kwa barua pepe badala yake.",
    emailTitle: "Angalia barua pepe yako",
    emailSentTo: "Tumetuma kiungo cha kuweka nenosiri kwenye",
    spam: "Angalia pia spam.",
    changeEmail: "Barua pepe si sahihi? Ibadilishe",
    passwordTitle: "Weka nenosiri lako",
    passwordIntro: "Utalitumia pamoja na namba yako ya simu kuingia kwenye kurasa za Code ya Punguzo.",
    signsInWith: "Utaingia kwa",
    newPassword: "Nenosiri jipya",
    confirmPassword: "Rudia nenosiri jipya",
    passwordRule: "Angalau herufi 6.",
    setPassword: "Weka nenosiri",
    saving: "Inahifadhi…",
    readyTitle: "Akaunti yako iko tayari!",
    emailUnusable: "Barua pepe hii haiwezi kutumika. Andika nyingine, au piga simu ofisini.",
    noEmail: "Andika barua pepe yako kwanza, mfano jina@mfano.com.",
    limited: "Maombi ni mengi mno kwa code hii leo. Jaribu tena kesho, au piga simu ofisini.",
    unavailable: "Huduma haipatikani kwa sasa. Jaribu tena baada ya muda mfupi.",
    checkPending: "Subiri ukaguzi wa usalama ukamilike, kisha uendelee.",
    passwordMismatch: "Manenosiri mawili hayafanani.",
    passwordTooShort: "Tumia angalau herufi 6.",
    steps: { choose: "Chagua", prove: "Thibitisha", password: "Nenosiri" },
  },
  en: {
    reviewNote: "We match this code to your names. Then you choose how to sign in and set your password yourself.",
    chooseTitle: "Choose how to sign in",
    chooseIntro: "You'll use this with your password every time you sign in.",
    byMobile: "With my mobile number",
    byMobileHint: "We'll text you a confirmation number.",
    byEmail: "With my email",
    byEmailHint: "We'll email you a link to set your password.",
    byEmailOffice: "The Marketing Office checks it first, then we email you a link to set your password.",
    continue: "Continue",
    smsTitle: "Check your SMS",
    smsSentTo: "We've sent a 6-digit confirmation number to",
    smsToRecord: "We've sent a 6-digit confirmation number to the mobile on our records.",
    smsNotTyped: "We sent it to the number on our records, not the one you typed. Don't have that number any more? Call the office.",
    number: "Confirmation number",
    digit: (n) => `Digit ${n} of 6`,
    sendAgainIn: "Send again in",
    sendAgain: "Send again",
    noSms: "No SMS?",
    noSmsHint: "Check the phone has signal, then send again.",
    orEmail: "Or sign in with your email: we'll send you a link to set your password.",
    useEmail: "Use email instead",
    close: "Close",
    wrong: "That number isn't right. Check it, then try again.",
    triesLeft: "Tries left:",
    tryAgain: "Try again",
    expired: "This number has expired. Send a new one.",
    sendNew: "Send a new number",
    locked: "For safety, we've stopped confirmation numbers for this code. Try again in 30 minutes.",
    mobileUsedTitle: "This number is already in use",
    mobileUsed: "This mobile number already signs in to another account, and one number can sign in to one account only. Sign in with your email instead.",
    emailTitle: "Check your email",
    emailSentTo: "We've sent a link to set your password to",
    spam: "Check spam too.",
    changeEmail: "Wrong email? Change it",
    passwordTitle: "Set your password",
    passwordIntro: "You'll use it with your mobile number to sign in to the Discount code pages.",
    signsInWith: "You'll sign in with",
    newPassword: "New password",
    confirmPassword: "Repeat new password",
    passwordRule: "At least 6 characters.",
    setPassword: "Set password",
    saving: "Saving…",
    readyTitle: "Your account is ready!",
    emailUnusable: "This email can't be used. Type another, or call the office.",
    noEmail: "Type your email first, for example name@example.com.",
    limited: "Too many requests for this code today. Try again tomorrow, or call the office.",
    unavailable: "The service isn't available right now. Try again in a moment.",
    checkPending: "Wait a moment for the security check to finish, then continue.",
    passwordMismatch: "The two passwords don't match.",
    passwordTooShort: "Use at least 6 characters.",
    steps: { choose: "Choose", prove: "Confirm", password: "Password" },
  },
}
