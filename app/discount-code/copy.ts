import type { AgentField } from "@/lib/agent-registration"
import type { Language } from "@/lib/language"

// The Discount code page's words, in Swahili and English. The page is for
// people the school wants to bring in families, but it never calls them
// agents and never mentions referrals or approval: the code is a Discount
// code, Code ya Punguzo. A native Swahili reader checks the Swahili before it
// ships.

type Copy = {
  title: string
  heading: string
  intro: string
  fullName: string
  phone: string
  phoneHint: string
  whatsapp: string
  whatsappHint: string
  optional: string
  securityNote: string
  send: string
  sending: string
  problems: Record<AgentField | "phone_unreadable", string>
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
  call: string
}

export const COPY: Record<Language, Copy> = {
  sw: {
    title: "Code ya Punguzo",
    heading: "Pata Code ya Punguzo",
    intro:
      "Shiriki Code yako ya Punguzo na familia unazozifahamu. Familia itakayoitumia itapata punguzo la TZS 20,000 kwenye ada ya usaili, shule itakapothibitisha code yako.",
    fullName: "Jina lako kamili",
    phone: "Namba ya simu",
    phoneHint: "Mfano: 0712 345 678",
    whatsapp: "Namba ya WhatsApp",
    whatsappHint: "Jaza tu kama ni tofauti na namba ya simu.",
    optional: "si lazima",
    securityNote: "Ukaguzi mfupi wa usalama hulinda fomu hii.",
    send: "Pata Code ya Punguzo",
    sending: "Inatuma…",
    problems: {
      full_name: "Andika jina lako kamili.",
      phone: "Andika namba yako ya simu.",
      phone_unreadable: "Hatukuweza kusoma namba hii ya simu. Iandike kama 0712 345 678 au +255 712 345 678.",
      whatsapp: "Hatukuweza kusoma namba hii ya WhatsApp. Iandike kama 0712 345 678, au iache wazi.",
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
    call: "Una swali? Piga simu ofisi ya udahili",
  },
  en: {
    title: "Discount code",
    heading: "Get a Discount code",
    intro:
      "Share your Discount code with families you know. Families who use it get TZS 20,000 off the interview fee once the school confirms your code.",
    fullName: "Your full name",
    phone: "Phone number",
    phoneHint: "For example: 0712 345 678",
    whatsapp: "WhatsApp number",
    whatsappHint: "Only if it is different from your phone number.",
    optional: "optional",
    securityNote: "A quick security check protects this form.",
    send: "Get my Discount code",
    sending: "Sending…",
    problems: {
      full_name: "Enter your full name.",
      phone: "Enter your phone number.",
      phone_unreadable: "We couldn't read that phone number. Write it like 0712 345 678 or +255 712 345 678.",
      whatsapp: "We couldn't read that WhatsApp number. Write it like 0712 345 678, or leave it empty.",
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
    call: "Questions? Call the admissions office",
  },
}
