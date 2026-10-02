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
  continue: string
  back: string
  send: string
  sending: string
  reviewParent: string
  reviewChild: string
  securityNote: string
  problems: Record<FormField | "phone_unreadable" | "year_closed", string>
  checkPending: string
  rateLimited: string
  checkFailed: string
  unavailable: string
  doneTitle: string
  admissionNumber: string
  keepNumber: string
  alreadySent: string
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
    continue: "Endelea",
    back: "Rudi",
    send: "Tuma maombi",
    sending: "Inatuma…",
    reviewParent: "Mzazi au mlezi",
    reviewChild: "Mtoto",
    securityNote: "Ukaguzi mfupi wa usalama hulinda fomu hii.",
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
      children: "Ongeza mtoto mmoja au zaidi.",
      submission_key: "Maombi yamebadilika tangu ulipotuma mara ya kwanza. Bonyeza Tuma maombi tena.",
      payload: "Hatukuweza kusoma fomu. Pakia ukurasa upya kisha ujaribu tena.",
    },
    checkPending: "Subiri ukaguzi wa usalama ukamilike, kisha utume.",
    rateLimited: "Umejaribu mara nyingi mno. Subiri dakika chache kisha ujaribu tena. Majibu yako bado yapo.",
    checkFailed: "Ukaguzi wa usalama haukukamilika. Jaribu kutuma tena. Majibu yako bado yapo.",
    unavailable: "Hatukuweza kupokea maombi yako kwa sasa. Majibu yako bado yapo; jaribu tena baada ya muda mfupi.",
    doneTitle: "Maombi yamepokelewa!",
    admissionNumber: "Namba ya Udahili",
    keepNumber: "Hifadhi namba hii na uje nayo shuleni. Utaulizwa ukifika.",
    alreadySent: "Fomu hii ilishatumwa kabla, kwa hiyo mabadiliko uliyofanya baadaye hayakuhifadhiwa. Piga simu ofisini kurekebisha taarifa yoyote.",
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
    continue: "Continue",
    back: "Back",
    send: "Send application",
    sending: "Sending…",
    reviewParent: "Parent or guardian",
    reviewChild: "Child",
    securityNote: "A quick security check protects this form.",
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
      children: "Add at least one child.",
      submission_key: "Your application changed since you first sent it. Tap Send application again.",
      payload: "We couldn't read the form. Reload the page and try again.",
    },
    checkPending: "Wait a moment for the security check to finish, then send.",
    rateLimited: "Too many tries. Wait a few minutes, then try again. Everything you typed is still here.",
    checkFailed: "The security check didn't finish. Try sending again. Everything you typed is still here.",
    unavailable: "We couldn't receive your application just now. Everything you typed is still here; try again in a moment.",
    doneTitle: "Application received!",
    admissionNumber: "Admission Number",
    keepNumber: "Keep this number and bring it when you come to the school. You'll be asked for it.",
    alreadySent: "This form had already been sent, so the changes you made afterwards weren't saved. Call the office to correct any details.",
    call: "Questions? Call the admissions office",
    again: "Fill in another form",
  },
}
