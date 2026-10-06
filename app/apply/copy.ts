import type { FormField } from "@/lib/admission-form"
import type { Language } from "@/lib/language"
import type { DayOrBoarding, Relationship } from "@/lib/services/leads"

// The Admission form's words, in Swahili and English. A native Swahili reader
// checks the Swahili before it ships. Class names stay as the school writes
// them (DAY CARE, STD 1, FORM 1) in both languages.

type Copy = {
  title: string
  stepOf: (step: number) => string
  steps: readonly [string, string, string]
  parentName: string
  relationship: string
  relationships: Record<Relationship, string>
  relationshipDescription: string
  phone: string
  phoneHint: string
  whatsapp: string
  whatsappHint: string
  optional: string
  child: string
  childName: string
  className: string
  enrollmentYear: string
  dayOrBoarding: string
  dayOrBoardingOptions: Record<DayOrBoarding, string>
  addChild: string
  removeChild: (child: number) => string
  maxChildren: (max: number) => string
  continue: string
  back: string
  send: string
  sending: string
  reviewParent: string
  reviewChild: string
  securityNote: string
  // The Discount code field and its notes. Never "agent" or "referral".
  discountCode: string
  discountCodeHint: string
  discountChecking: string
  discountNotes: Record<"approved" | "pending" | "unknown" | "unchecked", string>
  interviewFee: string
  feePerChild: (amount: string) => string
  feeTotal: (children: number, amount: string) => string
  problems: Record<FormField | "phone_unreadable" | "year_closed", string>
  // The same child on two cards, naming the child.
  duplicateChild: (name: string) => string
  checkPending: string
  rateLimited: string
  checkFailed: string
  unavailable: string
  doneTitle: string
  admissionNumber: string
  keepNumber: string
  keepNumbers: string
  alreadySent: string
  alreadySentInPart: string
  call: string
  again: string
}

export const COPY: Record<Language, Copy> = {
  sw: {
    title: "Fomu ya Udahili",
    stepOf: (step) => `Hatua ${step} kati ya 3`,
    steps: ["Mzazi au mlezi", "Watoto", "Hakiki maombi yako"],
    parentName: "Jina kamili la mzazi au mlezi",
    relationship: "Uhusiano na mtoto",
    relationships: { Mother: "Mama", Father: "Baba", Guardian: "Mlezi", Other: "Mwingine" },
    relationshipDescription: "Eleza uhusiano wako na mtoto",
    phone: "Namba ya simu",
    phoneHint: "Mfano: 0712 345 678",
    whatsapp: "Namba ya WhatsApp",
    whatsappHint: "Jaza tu kama ni tofauti na namba ya simu.",
    optional: "si lazima",
    child: "Mtoto",
    childName: "Jina kamili la mtoto",
    className: "Darasa analoomba",
    enrollmentYear: "Mwaka wa kujiunga",
    dayOrBoarding: "Kutwa au bweni",
    dayOrBoardingOptions: { Day: "Kutwa", Boarding: "Bweni" },
    addChild: "Ongeza mtoto mwingine",
    removeChild: (child) => `Ondoa mtoto ${child}`,
    maxChildren: (max) => `Unaweza kuomba kwa watoto hadi ${max} kwenye fomu moja.`,
    continue: "Endelea",
    back: "Rudi",
    send: "Tuma maombi",
    sending: "Inatuma…",
    reviewParent: "Mzazi au mlezi",
    reviewChild: "Mtoto",
    securityNote: "Ukaguzi mfupi wa usalama hulinda fomu hii.",
    discountCode: "Code ya Punguzo · si lazima",
    discountCodeHint: "Kama kuna mtu aliyekupa code ya punguzo, iandike hapa.",
    discountChecking: "Tunahakiki code…",
    discountNotes: {
      approved: "Punguzo la TZS 20,000 kwenye ada ya usaili kwa kila mtoto.",
      pending: "Code hii inasubiri kuthibitishwa. Punguzo litatumika ikithibitishwa kabla hujalipa.",
      unknown: "Hatuitambui code hii. Ihakiki, au tuma fomu bila code.",
      unchecked: "Hatukuweza kuhakiki code yako kwa sasa. Itahifadhiwa pamoja na maombi yako.",
    },
    interviewFee: "Ada ya usaili",
    feePerChild: (amount) => `${amount} kwa kila mtoto`,
    feeTotal: (children, amount) => (children === 1 ? `Jumla: ${amount}` : `Jumla kwa watoto ${children}: ${amount}`),
    problems: {
      contact_name: "Andika jina kamili la mzazi au mlezi.",
      relationship: "Chagua uhusiano wako na mtoto.",
      relationship_description: "Eleza uhusiano wako na mtoto.",
      phone: "Andika namba yako ya simu.",
      phone_unreadable: "Hatukuweza kusoma namba hii ya simu. Iandike kama 0712 345 678 au +255 712 345 678.",
      whatsapp: "Hatukuweza kusoma namba hii ya WhatsApp. Iandike kama 0712 345 678, au iache wazi.",
      student_name: "Andika jina kamili la mtoto.",
      class_name: "Chagua darasa analoomba.",
      enrollment_year: "Chagua mwaka wa kujiunga.",
      year_closed: "Mwaka huo haupokei maombi tena. Chagua mwaka mwingine.",
      day_or_boarding: "Chagua kutwa au bweni.",
      duplicate_child: "Mtoto huyu ameandikwa mara mbili.",
      discount_code: "Code ya punguzo ina herufi, namba, - na . tu, hadi 20. Ihakiki, au ifute ili utume bila code.",
      children: "Ongeza mtoto mmoja au zaidi.",
      submission_key: "Maombi yamebadilika tangu ulipotuma mara ya kwanza. Bonyeza Tuma maombi tena.",
      payload: "Hatukuweza kusoma fomu. Pakia ukurasa upya kisha ujaribu tena.",
    },
    duplicateChild: (name) => `${name} yupo mara mbili kwenye fomu hii. Ondoa mojawapo ya kadi hizo mbili, au sahihisha jina.`,
    checkPending: "Subiri ukaguzi wa usalama ukamilike, kisha utume.",
    rateLimited: "Umejaribu mara nyingi mno. Subiri dakika chache kisha ujaribu tena. Majibu yako bado yapo.",
    checkFailed: "Ukaguzi wa usalama haukukamilika. Jaribu kutuma tena. Majibu yako bado yapo.",
    unavailable: "Hatukuweza kupokea maombi yako kwa sasa. Majibu yako bado yapo; jaribu tena baada ya muda mfupi.",
    doneTitle: "Maombi yamepokelewa!",
    admissionNumber: "Namba ya Udahili",
    keepNumber: "Hifadhi namba hii na uje nayo shuleni. Utaulizwa ukifika.",
    keepNumbers: "Hifadhi namba hizi na uje nazo shuleni. Utaulizwa ukifika.",
    alreadySent: "Fomu hii ilishatumwa kabla, kwa hiyo mabadiliko uliyofanya baadaye hayakuhifadhiwa. Piga simu ofisini kurekebisha taarifa yoyote.",
    alreadySentInPart: "Fomu hii ilishatumwa kabla, lakini si watoto wote waliokuwa ndani yake walipokelewa, na mabadiliko uliyofanya baadaye hayakuhifadhiwa. Piga simu ofisini ili tukamilishe maombi.",
    call: "Una swali? Piga simu ofisi ya udahili",
    again: "Jaza fomu nyingine",
  },
  en: {
    title: "Admission Form",
    stepOf: (step) => `Step ${step} of 3`,
    steps: ["Parent or guardian", "Children", "Check your application"],
    parentName: "Parent or guardian's full name",
    relationship: "Relationship to the child",
    relationships: { Mother: "Mother", Father: "Father", Guardian: "Guardian", Other: "Other" },
    relationshipDescription: "Describe your relationship to the child",
    phone: "Phone number",
    phoneHint: "For example: 0712 345 678",
    whatsapp: "WhatsApp number",
    whatsappHint: "Only if it is different from your phone number.",
    optional: "optional",
    child: "Child",
    childName: "Child's full name",
    className: "Class applying for",
    enrollmentYear: "Year of enrolment",
    dayOrBoarding: "Day or boarding",
    dayOrBoardingOptions: { Day: "Day", Boarding: "Boarding" },
    addChild: "Add another child",
    removeChild: (child) => `Remove child ${child}`,
    maxChildren: (max) => `You can apply for up to ${max} children on one form.`,
    continue: "Continue",
    back: "Back",
    send: "Send application",
    sending: "Sending…",
    reviewParent: "Parent or guardian",
    reviewChild: "Child",
    securityNote: "A quick security check protects this form.",
    discountCode: "Discount code · optional",
    discountCodeHint: "If someone gave you a discount code, enter it here.",
    discountChecking: "Checking the code…",
    discountNotes: {
      approved: "TZS 20,000 off the interview fee for each child.",
      pending: "This code is waiting to be confirmed. The discount applies if it is confirmed before you pay.",
      unknown: "We don't recognise this code. Check it, or send the form without it.",
      unchecked: "We couldn't check your code just now. It will still be saved with your application.",
    },
    interviewFee: "Interview fee",
    feePerChild: (amount) => `${amount} per child`,
    feeTotal: (children, amount) => (children === 1 ? `Total: ${amount}` : `Total for ${children} children: ${amount}`),
    problems: {
      contact_name: "Enter the parent or guardian's full name.",
      relationship: "Choose your relationship to the child.",
      relationship_description: "Describe your relationship to the child.",
      phone: "Enter your phone number.",
      phone_unreadable: "We couldn't read that phone number. Write it like 0712 345 678 or +255 712 345 678.",
      whatsapp: "We couldn't read that WhatsApp number. Write it like 0712 345 678, or leave it empty.",
      student_name: "Enter the child's full name.",
      class_name: "Choose the class the child is applying for.",
      enrollment_year: "Choose the year of enrolment.",
      year_closed: "That year no longer takes applications. Choose another year.",
      day_or_boarding: "Choose day or boarding.",
      duplicate_child: "This child is listed twice.",
      discount_code: "A discount code has only letters, numbers, - and ., up to 20. Check it, or clear it to send without a code.",
      children: "Add at least one child.",
      submission_key: "Your application changed since you first sent it. Tap Send application again.",
      payload: "We couldn't read the form. Reload the page and try again.",
    },
    duplicateChild: (name) => `${name} is on this form twice. Remove one of the two cards, or correct the name.`,
    checkPending: "Wait a moment for the security check to finish, then send.",
    rateLimited: "Too many tries. Wait a few minutes, then try again. Everything you typed is still here.",
    checkFailed: "The security check didn't finish. Try sending again. Everything you typed is still here.",
    unavailable: "We couldn't receive your application just now. Everything you typed is still here; try again in a moment.",
    doneTitle: "Application received!",
    admissionNumber: "Admission Number",
    keepNumber: "Keep this number and bring it when you come to the school. You'll be asked for it.",
    keepNumbers: "Keep these numbers and bring them when you come to the school. You'll be asked for them.",
    alreadySent: "This form had already been sent, so the changes you made afterwards weren't saved. Call the office to correct any details.",
    alreadySentInPart: "This form had already been sent, but not every child on it was received, and the changes you made afterwards weren't saved. Call the office so we can finish the application.",
    call: "Questions? Call the admissions office",
    again: "Fill in another form",
  },
}
