import type { AgentField } from "@/lib/agent-registration"
import type { Language } from "@/lib/language"

import type { DiscountCodeMessage } from "./outcome"

// The Discount code page's words, in Swahili and English. The page is for
// people the school wants to bring in families, but it never calls them
// agents and never mentions referrals or approval: the code is a Discount
// code, Code ya Punguzo. A native Swahili reader checks the Swahili before it
// ships. The sign-up outcomes' Swahili is the owner's wording (#193).

// The answers that keep the form, other than the checks before sending.
type SignUpMessage = Exclude<DiscountCodeMessage, "rate-limited" | "check-failed" | "unavailable">

type Copy = {
  // The page title: the tab, and the sr-only h1 above the form.
  title: string
  // Takes the discount as written ("TZS 10,000"), or null when it couldn't be
  // read, and then names no figure.
  intro: (discount: string | null) => string
  // The progress bar's two groups: you (name, phone, WhatsApp), then the code (email, code).
  groups: { you: string; code: string }
  back: string
  startOver: string
  // The progress line read to screen readers.
  progress: (group: string, step: number, of: number) => string
  progressDone: string
  next: string
  // The questions, one at a time; the short labels name the folded answers.
  nameQuestion: string
  fullName: string
  phoneQuestion: string
  phone: string
  phoneHint: string
  whatsappDifferent: string
  whatsapp: string
  email: string
  emailQuestion: string
  emailHint: string
  hasCode: string
  hasCodeHint: string
  yes: string
  no: string
  code: string
  codeHint: string
  reviewQuestion: string
  reviewHint: string
  // The two-word links on the folded answers.
  change: { name: string; phone: string; email: string; code: string }
  signInPrompt: string
  signIn: string
  optional: string
  send: string
  sending: string
  problems: Record<AgentField | "phone_unreadable" | "code_unreadable", string>
  messages: Record<SignUpMessage, string>
  checkPending: string
  rateLimited: string
  checkFailed: string
  unavailable: string
  doneTitle: string
  linkLabel: string
  copy: string
  copied: string
  copyFailed: string
  share: string
  shareText: (code: string, link: string) => string
  confirmNote: string
  // On a new code's done page: where the set-password email will go.
  emailNote: (email: string) => string
  // On a claimed code's done page.
  claimNote: string
  call: string
}

export const COPY: Record<Language, Copy> = {
  sw: {
    title: "Code ya Punguzo",
    intro: (discount) =>
      `Shiriki Code yako ya Punguzo na familia unazozifahamu. Familia itakayoitumia itapata punguzo${discount ? ` la ${discount}` : ""} kwenye ada ya usaili, shule itakapothibitisha code yako.`,
    groups: { you: "Wewe", code: "Code" },
    back: "Rudi",
    startOver: "Anza upya",
    progress: (group, step, of) => `${group}: hatua ${step} kati ya ${of}`,
    progressDone: "Kila kitu kimejazwa. Hakiki kisha utume.",
    next: "Endelea",
    nameQuestion: "Unaitwa nani?",
    fullName: "Jina lako kamili",
    phoneQuestion: "Namba yako ya simu?",
    phone: "Namba ya simu",
    phoneHint: "Mfano: 0712 345 678",
    whatsappDifferent: "Namba yangu ya WhatsApp ni tofauti",
    whatsapp: "Namba ya WhatsApp",
    email: "Barua pepe",
    emailQuestion: "Barua pepe yako?",
    emailHint: "Utapokea barua pepe ya kuweka nenosiri hapa.",
    hasCode: "Tayari una code?",
    hasCodeHint: "Una code lakini bado hujapokea barua pepe ya kuweka nenosiri? Chagua Ndiyo.",
    yes: "Ndiyo",
    no: "Hapana",
    code: "Code yako ya Punguzo",
    codeHint: "Iandike kama ulivyopewa, mfano ABC-123.",
    reviewQuestion: "Hakiki kisha utume",
    reviewHint: "Gusa Badilisha kurekebisha chochote.",
    change: { name: "Badilisha Jina", phone: "Badilisha Namba", email: "Badilisha Barua pepe", code: "Badilisha Code" },
    signInPrompt: "Umeshaweka nenosiri?",
    signIn: "Ingia",
    optional: "si lazima",
    send: "Pata Code ya Punguzo",
    sending: "Inatuma…",
    problems: {
      full_name: "Andika jina lako kamili.",
      phone: "Andika namba yako ya simu.",
      phone_unreadable: "Hatukuweza kusoma namba hii ya simu. Iandike kama 0712 345 678 au +255 712 345 678.",
      whatsapp: "Hatukuweza kusoma namba hii ya WhatsApp. Iandike kama 0712 345 678, au iache wazi.",
      email: "Andika barua pepe yako, mfano jina@mfano.com.",
      code: "Andika Code yako ya Punguzo.",
      code_unreadable: "Hatukuweza kusoma code hii. Iandike kama ulivyopewa, mfano ABC-123.",
    },
    messages: {
      "code-needed": "Namba hii tayari ina Code ya Punguzo. Weka alama kwenye 'Tayari una code?' na uiandike, au piga simu ofisini.",
      "phone-mismatch": "Hatukuweza kulinganisha code na namba hii. Zihakiki, au piga simu ofisini.",
      "no-match": "Hatukupata code hii. Ihakiki, au piga simu ofisini.",
      "claim-waiting": "Tumepokea ombi lako; shule itathibitisha.",
      invited: "Tumekutumia barua pepe. Angalia spam, au tumia 'Tuma kiungo kipya'.",
      joined: "Tayari una akaunti. Ingia.",
      "email-unusable": "Barua pepe hii haiwezi kutumika. Tumia nyingine au piga simu ofisini.",
      "access-off": "Huduma hii imesimamishwa kwa muda.",
    },
    checkPending: "Subiri ukaguzi wa usalama ukamilike, kisha utume.",
    rateLimited: "Umejaribu mara nyingi mno. Subiri dakika chache kisha ujaribu tena. Majibu yako bado yapo.",
    checkFailed: "Ukaguzi wa usalama haukukamilika. Jaribu tena. Majibu yako bado yapo.",
    unavailable: "Hatukuweza kukupatia code kwa sasa. Majibu yako bado yapo; jaribu tena baada ya muda mfupi.",
    doneTitle: "Code yako ya Punguzo",
    linkLabel: "Kiungo chako",
    copy: "Nakili kiungo",
    copied: "Kiungo kimenakiliwa",
    copyFailed: "Hatukuweza kunakili. Bonyeza kiungo kwa muda kisha ukinakili.",
    share: "Shiriki kwenye WhatsApp",
    shareText: (code, link) =>
      `Jaza fomu ya udahili ya Al-Rahmah Complex kupitia kiungo hiki. Code yangu ya Punguzo, ${code}, itakuwa imeshajazwa: ${link}`,
    confirmNote:
      "Punguzo litaanza kufanya kazi shule itakapothibitisha code yako. Shule itawasiliana nawe. Unaweza kuanza kushiriki code na kiungo sasa hivi.",
    emailNote: (email) =>
      `Shule itakapothibitisha code yako, utapokea barua pepe ya kuweka nenosiri kwenye ${email}. Ikichelewa, angalia spam.`,
    claimNote:
      "Shule itathibitisha barua pepe yako, kisha utapokea barua pepe ya kuweka nenosiri. Ikichelewa, angalia spam.",
    call: "Una swali? Piga simu ofisi ya udahili",
  },
  en: {
    title: "Discount code",
    intro: (discount) =>
      `Share your Discount code with families you know. Families who use it get ${discount ? `${discount} off` : "a discount on"} the interview fee once the school confirms your code.`,
    groups: { you: "You", code: "Code" },
    back: "Back",
    startOver: "Start over",
    progress: (group, step, of) => `${group}: step ${step} of ${of}`,
    progressDone: "Everything is filled in. Check, then send.",
    next: "Continue",
    nameQuestion: "What's your name?",
    fullName: "Your full name",
    phoneQuestion: "Your phone number?",
    phone: "Phone number",
    phoneHint: "For example: 0712 345 678",
    whatsappDifferent: "My WhatsApp number is different",
    whatsapp: "WhatsApp number",
    email: "Email",
    emailQuestion: "Your email?",
    emailHint: "We send the email to set your password here.",
    hasCode: "Already have a Discount code?",
    hasCodeHint: "Have a code but no email to set a password yet? Choose Yes.",
    yes: "Yes",
    no: "No",
    code: "Your Discount code",
    codeHint: "Type it as you were given it, for example ABC-123.",
    reviewQuestion: "Check, then send",
    reviewHint: "Tap Change to fix anything.",
    change: { name: "Change Name", phone: "Change Number", email: "Change Email", code: "Change Code" },
    signInPrompt: "Already set a password?",
    signIn: "Sign in",
    optional: "optional",
    send: "Get my Discount code",
    sending: "Sending…",
    problems: {
      full_name: "Enter your full name.",
      phone: "Enter your phone number.",
      phone_unreadable: "We couldn't read that phone number. Write it like 0712 345 678 or +255 712 345 678.",
      whatsapp: "We couldn't read that WhatsApp number. Write it like 0712 345 678, or leave it empty.",
      email: "Enter your email, for example name@example.com.",
      code: "Enter your Discount code.",
      code_unreadable: "We couldn't read that code. Type it as you were given it, for example ABC-123.",
    },
    messages: {
      "code-needed":
        "This number already has a Discount code. Tick 'Already have a Discount code?' and type it, or call the office.",
      "phone-mismatch": "We couldn't match the code with this number. Check both, or call the office.",
      "no-match": "We couldn't find this code. Check it, or call the office.",
      "claim-waiting": "We have your request; the school will confirm it.",
      invited: "We have sent you an email. Check spam, or use 'Send a new link'.",
      joined: "You already have an account. Sign in.",
      "email-unusable": "This email can't be used. Use another or call the office.",
      "access-off": "This service is paused for now.",
    },
    checkPending: "Wait a moment for the security check to finish, then send.",
    rateLimited: "Too many tries. Wait a few minutes, then try again. Everything you typed is still here.",
    checkFailed: "The security check didn't finish. Try again. Everything you typed is still here.",
    unavailable: "We couldn't give you a code just now. Everything you typed is still here; try again in a moment.",
    doneTitle: "Your Discount code",
    linkLabel: "Your link",
    copy: "Copy link",
    copied: "Link copied",
    copyFailed: "We couldn't copy it. Press and hold the link to copy it.",
    share: "Share on WhatsApp",
    shareText: (code, link) =>
      `Apply to Al-Rahmah Complex through this link. My Discount code ${code} will already be filled in: ${link}`,
    confirmNote:
      "The discount starts once the school confirms your code. The school will contact you. You can start sharing your code and link now.",
    emailNote: (email) =>
      `Once the school confirms your code, you'll get an email at ${email} to set your password. If it's slow to arrive, check spam.`,
    claimNote: "The school will confirm your email, then you'll get an email to set your password. If it's slow to arrive, check spam.",
    call: "Questions? Call the admissions office",
  },
}
