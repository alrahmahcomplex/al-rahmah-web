import type { FormField } from "@/lib/admission-form"
import type { Language } from "@/lib/language"
import type { DayOrBoarding, Relationship } from "@/lib/services/leads"

// The Admission form's words, in Swahili and English, for the one-question-
// at-a-time form (concept C). New Swahili comes from the approved prototype;
// problems and notices keep the wording the form already had, with
// "mwanafunzi" for "mtoto". Class names stay as the school writes them
// (DAY CARE, STD 1, FORM 1) in both languages. Never "agent", "referral",
// "wakala" or "idhini": the code is always the Discount code.

const ORDINALS_SW = ["kwanza", "pili", "tatu", "nne", "tano", "sita", "saba", "nane"]
const ORDINALS_EN = ["one", "two", "three", "four", "five", "six", "seven", "eight"]

export type ChangeWord = "name" | "class" | "year" | "board" | "pname" | "rel" | "phone" | "code" | "kid"
export type CodeStatusWord = "approved" | "pending" | "switched_off" | "unknown"

type Copy = {
  title: string
  // The progress bar and the group titles.
  sections: readonly [string, string, string]
  oneStudent: string
  who: (n: number) => string
  progress: (section: string, step: number, of: number, who: string | null) => string
  progressDone: string
  back: string
  reset: string
  resetDone: string
  cleared: string
  continue: string
  change: Record<ChangeWord, string>
  // Students.
  student: (n: number) => string
  studentName: string
  studentNameQ: (n: number) => string
  studentNameHint: string
  classQ: (name: string) => string
  className: string
  popular: string
  chooseOther: string
  sheetTitle: string
  classGroups: { nursery: string; primary: string; secondary: string }
  close: string
  joining: (year: number) => { before: string; year: string }
  yearName: string
  thisYear: string
  nextYear: string
  boardingQ: (name: string) => string
  boardingName: string
  dayOrBoarding: Record<DayOrBoarding, string>
  dayOrBoardingHint: Record<DayOrBoarding, string>
  sameAs: (name: string) => string
  anotherQ: string
  anotherYes: string
  anotherNo: string
  noMore: string
  addStudent: string
  removeStudent: string
  removeNamed: (name: string) => string
  maxChildren: (max: number) => string
  // The custodian.
  parentBlock: string
  parentNameQ: string
  parentName: string
  relQ: (name: string | null) => string
  relQMany: string
  relName: string
  relationships: Record<Relationship, string>
  relDescribe: string
  phoneQ: string
  phone: string
  phoneHint: string
  whatsappDifferent: string
  whatsapp: string
  optional: string
  // The interview: Discount code, fee, send.
  haveCode: string
  codeLabel: string
  codeHint: string
  codeCheck: string
  codeSkip: string
  codeNone: string
  codeChecking: string
  codeStatus: Record<CodeStatusWord, string>
  anchorWithout: string
  anchorWith: string
  anchorSave: (amount: string) => string
  // `approved` takes the discount per student as written ("TZS 10,000"), or
  // null when it couldn't be read, and then names no figure.
  discountNotes: { approved: (discount: string | null) => string } & Record<"pending" | "switched_off" | "unknown" | "unchecked", string>
  offerTitle: string
  offerBody: (students: number) => string
  feeQ: string
  feeStudents: (n: number) => string
  feeTotal: string
  feeWhen: string
  savedTotal: (amount: string) => string
  offerPill: string
  offerInfo: string
  sheetOffer: {
    title: string
    saved: string
    limited: (discount: string) => string
    withdrawn: string
    applications: (count: string) => string
    bring: (students: number) => string
    ok: string
  }
  reviewQ: string
  reviewSub: string
  send: string
  sending: string
  // Problems and notices.
  problems: Record<FormField | "phone_unreadable" | "year_closed", string>
  duplicateChild: (name: string) => string
  checkPending: string
  rateLimited: string
  checkFailed: string
  unavailable: string
  // The confirmation.
  doneTitle: string
  admissionNumber: string
  keepNumber: string
  keepNumbers: string
  copy: string
  copied: string
  whatsappSelf: string
  whatsappText: (lines: string) => string
  doneOfferTitle: (amount: string) => string
  // The success offer: the text around the live count. `count` is false when
  // the count is unknown or below the minimum, and the sentence naming it is
  // left out.
  doneOffer: (students: number) => { lead: string; count: string; after: string }
  alreadySent: string
  alreadySentInPart: string
  call: string
  again: string
}

export const COPY: Record<Language, Copy> = {
  sw: {
    title: "Fomu ya Udahili",
    sections: ["Wanafunzi", "Msimamizi", "Usaili"],
    oneStudent: "Mwanafunzi",
    who: (n) => `Mwanafunzi wa ${ORDINALS_SW[n - 1]}`,
    progress: (section, step, of, who) => `${who ? `${who}, ` : ""}${section}: hatua ${step} kati ya ${of}`,
    progressDone: "Kila kitu kimejazwa. Hakiki kisha utume.",
    back: "Rudi",
    reset: "Anza upya",
    resetDone: "Fomu imeanza upya.",
    cleared: "Fomu imefutwa. Anza upya.",
    continue: "Endelea",
    change: {
      name: "Badilisha Jina",
      class: "Badilisha Darasa",
      year: "Badilisha Mwaka",
      board: "Badilisha Malazi",
      pname: "Badilisha Jina",
      rel: "Badilisha Uhusiano",
      phone: "Badilisha Namba",
      code: "Badilisha Code",
      kid: "Badilisha Taarifa",
    },
    student: (n) => `Mwanafunzi ${n}`,
    studentName: "Jina kamili la mwanafunzi",
    studentNameQ: (n) => (n === 1 ? "Mwanafunzi anaitwa nani?" : `Mwanafunzi wa ${ORDINALS_SW[n - 1]} anaitwa nani?`),
    studentNameHint: "Kama lilivyo kwenye cheti cha kuzaliwa.",
    classQ: (name) => (name ? `${name} anaomba darasa gani?` : "Anaomba darasa gani?"),
    className: "Darasa analoomba",
    popular: "Wazazi wengi huchagua",
    chooseOther: "Chagua darasa lingine",
    sheetTitle: "Chagua darasa",
    classGroups: { nursery: "Awali", primary: "Msingi", secondary: "Sekondari" },
    close: "Funga",
    joining: (year) => ({ before: "Kujiunga mwaka", year: String(year) }),
    yearName: "Mwaka wa kujiunga",
    thisYear: "Mwaka huu",
    nextYear: "Mwaka ujao",
    boardingQ: (name) => (name ? `${name} atakuwa wa kutwa au bweni?` : "Kutwa au bweni?"),
    boardingName: "Kutwa au bweni",
    dayOrBoarding: { Day: "Kutwa", Boarding: "Bweni" },
    dayOrBoardingHint: { Day: "Anarudi nyumbani kila siku", Boarding: "Analala shuleni" },
    sameAs: (name) => `Sawa na ${name}`,
    anotherQ: "Unaomba kwa mwanafunzi mwingine pia?",
    anotherYes: "Ndiyo, ongeza mwanafunzi",
    anotherNo: "Hapana, endelea",
    noMore: "Hakuna mwanafunzi mwingine",
    addStudent: "Ongeza Mwanafunzi",
    removeStudent: "Ondoa Mwanafunzi",
    removeNamed: (name) => `Ondoa ${name}`,
    maxChildren: (max) => `Unaweza kuomba kwa wanafunzi hadi ${max} kwenye fomu moja.`,
    parentBlock: "Msimamizi",
    parentNameQ: "Jina lako kamili ni nani?",
    parentName: "Jina kamili la msimamizi",
    relQ: (name) => (name ? `Wewe ni nani kwa ${name}?` : "Uhusiano wako na mwanafunzi"),
    relQMany: "Wewe ni nani kwa wanafunzi hawa?",
    relName: "Uhusiano na mwanafunzi",
    relationships: { Mother: "Mama", Father: "Baba", Guardian: "Mlezi", Other: "Mwingine" },
    relDescribe: "Eleza uhusiano wako na mwanafunzi",
    phoneQ: "Namba yako ya simu ni ipi?",
    phone: "Namba ya simu",
    phoneHint: "Ofisi ya udahili itakupigia kwa namba hii.",
    whatsappDifferent: "Namba yangu ya WhatsApp ni tofauti",
    whatsapp: "Namba ya WhatsApp",
    optional: "si lazima",
    haveCode: "Una code ya punguzo?",
    codeLabel: "Code ya Punguzo",
    codeHint: "Kama kuna mtu aliyekupa code, iandike hapa.",
    codeCheck: "Hakiki Punguzo",
    codeSkip: "Ruka, sina code",
    codeNone: "Hakuna code",
    codeChecking: "Tunahakiki code…",
    codeStatus: { approved: "imethibitishwa", pending: "inasubiri", switched_off: "haitoi punguzo", unknown: "haitambuliki" },
    anchorWithout: "Bila code",
    anchorWith: "Ukiwa na code",
    anchorSave: (amount) => `Okoa ${amount}`,
    discountNotes: {
      approved: (discount) =>
        discount ? `Hongera! Umeokoa ${discount} kwa kila mwanafunzi.` : "Hongera! Code imethibitishwa: kuna punguzo kwenye ada ya usaili kwa kila mwanafunzi.",
      pending: "Code hii inasubiri kuthibitishwa. Punguzo litatumika ikithibitishwa kabla hujalipa.",
      switched_off: "Code hii haitoi punguzo kwa sasa. Unaweza kutuma fomu.",
      unknown: "Hatuitambui code hii. Ihakiki, au tuma fomu bila code.",
      unchecked: "Hatukuweza kuhakiki code yako kwa sasa. Itahifadhiwa pamoja na maombi yako.",
    },
    offerTitle: "Ofa hii ni ya muda mfupi",
    offerBody: (n) =>
      `Punguzo linaweza kuondolewa wakati wowote. Njoo na ${n > 1 ? "wanafunzi" : "mwanafunzi"} kwa usaili mapema usije ukalikosa.`,
    feeQ: "Ada ya usaili",
    feeStudents: (n) => (n > 1 ? `Wanafunzi ${n}` : "Mwanafunzi 1"),
    feeTotal: "Jumla",
    feeWhen: "Hulipi chochote kwenye fomu hii. Utalipa ukifika shuleni.",
    savedTotal: (amount) => `Umeokoa ${amount}`,
    offerPill: "Ofa ya muda maalum",
    offerInfo: "Kuhusu ofa ya muda maalum",
    sheetOffer: {
      title: "Ofa ya muda maalum",
      saved: "Umeokoa",
      limited: (discount) => `Punguzo la ${discount} kwa kila mwanafunzi ni la muda maalumu.`,
      withdrawn: "Linaweza kuondolewa wakati wowote, hata kabla ya usaili wako.",
      applications: (count) => `Nafasi ni chache: mpaka sasa tuna maombi ${count}.`,
      bring: (n) => `Mlete ${n > 1 ? "wanafunzi" : "mwanafunzi"} kwenye usaili wiki hii, ndani ya siku za kazi.`,
      ok: "Sawa, nimeelewa",
    },
    reviewQ: "Hakiki kisha utume",
    reviewSub: "Gusa Badilisha kurekebisha chochote.",
    send: "Tuma maombi",
    sending: "Inatuma…",
    problems: {
      contact_name: "Andika jina kamili la msimamizi.",
      relationship: "Chagua uhusiano wako na mwanafunzi.",
      relationship_description: "Eleza uhusiano wako na mwanafunzi.",
      phone: "Andika namba yako ya simu.",
      phone_unreadable: "Hatukuweza kusoma namba hii ya simu. Iandike kama 0712 345 678 au +255 712 345 678.",
      whatsapp: "Hatukuweza kusoma namba hii ya WhatsApp. Iandike kama 0712 345 678, au iache wazi.",
      student_name: "Andika jina kamili la mwanafunzi.",
      class_name: "Chagua darasa analoomba.",
      enrollment_year: "Chagua mwaka wa kujiunga.",
      year_closed: "Mwaka huo haupokei maombi tena. Chagua mwaka mwingine.",
      day_or_boarding: "Chagua kutwa au bweni.",
      duplicate_child: "Mwanafunzi huyu ameandikwa mara mbili.",
      discount_code: "Code ya punguzo ina herufi, namba, - na . tu, hadi 20. Ihakiki, au ifute ili utume bila code.",
      children: "Ongeza mwanafunzi mmoja au zaidi.",
      submission_key: "Maombi yamebadilika tangu ulipotuma mara ya kwanza. Bonyeza Tuma maombi tena.",
      payload: "Hatukuweza kusoma fomu. Pakia ukurasa upya kisha ujaribu tena.",
    },
    duplicateChild: (name) => `${name} yupo mara mbili kwenye fomu hii. Ondoa mmoja, au sahihisha jina.`,
    checkPending: "Subiri ukaguzi wa usalama ukamilike, kisha utume.",
    rateLimited: "Umejaribu mara nyingi mno. Subiri dakika chache kisha ujaribu tena. Majibu yako bado yapo.",
    checkFailed: "Ukaguzi wa usalama haukukamilika. Jaribu kutuma tena. Majibu yako bado yapo.",
    unavailable: "Hatukuweza kupokea maombi yako kwa sasa. Majibu yako bado yapo; jaribu tena baada ya muda mfupi.",
    doneTitle: "Maombi yamepokelewa!",
    admissionNumber: "Namba ya Udahili",
    keepNumber: "Hifadhi namba hii na uje nayo shuleni. Utaulizwa ukifika.",
    keepNumbers: "Hifadhi namba hizi na uje nazo shuleni. Utaulizwa ukifika.",
    copy: "Nakili",
    copied: "Imenakiliwa",
    whatsappSelf: "Jitumie kwenye WhatsApp",
    whatsappText: (lines) => `Al-Rahmah Complex · Namba ya Udahili\n${lines}`,
    doneOfferTitle: (amount) => `Punguzo lako la ${amount} linakusubiri`,
    doneOffer: (n) => ({
      lead: "Ofa hii ni ya muda maalumu na inaweza kuondolewa wakati wowote.",
      count: "Pia nafasi ni chache sababu mpaka sasa tuna maombi",
      after:
        n > 1
          ? "Hivyo walete wanafunzi kwenye usaili mapema, Ikiwezekana walete wiki hii ndani ya siku za kazi."
          : "Hivyo mlete mwanafunzi kwenye usaili mapema, Ikiwezekana mlete wiki hii ndani ya siku za kazi.",
    }),
    alreadySent: "Fomu hii ilishatumwa kabla, kwa hiyo mabadiliko uliyofanya baadaye hayakuhifadhiwa. Piga simu ofisini kurekebisha taarifa yoyote.",
    alreadySentInPart:
      "Fomu hii ilishatumwa kabla, lakini si wanafunzi wote waliokuwa ndani yake walipokelewa, na mabadiliko uliyofanya baadaye hayakuhifadhiwa. Piga simu ofisini ili tukamilishe maombi.",
    call: "Una swali? Piga simu ofisi ya udahili",
    again: "Jaza fomu nyingine",
  },
  en: {
    title: "Admission Form",
    sections: ["Students", "Custodian", "Interview"],
    oneStudent: "Student",
    who: (n) => `Student ${ORDINALS_EN[n - 1]}`,
    progress: (section, step, of, who) => `${who ? `${who}, ` : ""}${section}: step ${step} of ${of}`,
    progressDone: "Everything is filled in. Check, then send.",
    back: "Back",
    reset: "Start over",
    resetDone: "The form has started over.",
    cleared: "The form is cleared. Start again.",
    continue: "Continue",
    change: {
      name: "Change Name",
      class: "Change Class",
      year: "Change Year",
      board: "Change Residence",
      pname: "Change Name",
      rel: "Change Relationship",
      phone: "Change Number",
      code: "Change Code",
      kid: "Change Details",
    },
    student: (n) => `Student ${n}`,
    studentName: "Student's full name",
    studentNameQ: (n) => (n === 1 ? "What is the student's name?" : `What is student ${ORDINALS_EN[n - 1]}'s name?`),
    studentNameHint: "As it is on the birth certificate.",
    classQ: (name) => (name ? `Which class is ${name} applying for?` : "Which class are they applying for?"),
    className: "Class applying for",
    popular: "Most parents choose",
    chooseOther: "Choose another class",
    sheetTitle: "Choose a class",
    classGroups: { nursery: "Nursery", primary: "Primary", secondary: "Secondary" },
    close: "Close",
    joining: (year) => ({ before: "Joining in", year: String(year) }),
    yearName: "Year of enrolment",
    thisYear: "This year",
    nextYear: "Next year",
    boardingQ: (name) => (name ? `Will ${name} be a day scholar or a boarder?` : "Day or boarding?"),
    boardingName: "Day or boarding",
    dayOrBoarding: { Day: "Day", Boarding: "Boarding" },
    dayOrBoardingHint: { Day: "Goes home every day", Boarding: "Sleeps at school" },
    sameAs: (name) => `Same as ${name}`,
    anotherQ: "Are you applying for another student too?",
    anotherYes: "Yes, add a student",
    anotherNo: "No, continue",
    noMore: "No other student",
    addStudent: "Add Student",
    removeStudent: "Remove Student",
    removeNamed: (name) => `Remove ${name}`,
    maxChildren: (max) => `You can apply for up to ${max} students on one form.`,
    parentBlock: "Custodian",
    parentNameQ: "What is your full name?",
    parentName: "Custodian's full name",
    relQ: (name) => (name ? `Who are you to ${name}?` : "Relationship to the student"),
    relQMany: "Who are you to the students?",
    relName: "Relationship to the student",
    relationships: { Mother: "Mother", Father: "Father", Guardian: "Guardian", Other: "Other" },
    relDescribe: "Describe your relationship to the student",
    phoneQ: "What is your phone number?",
    phone: "Phone number",
    phoneHint: "The admissions office will call you on this number.",
    whatsappDifferent: "My WhatsApp number is different",
    whatsapp: "WhatsApp number",
    optional: "optional",
    haveCode: "Have a discount code?",
    codeLabel: "Discount code",
    codeHint: "If someone gave you a code, enter it here.",
    codeCheck: "Check Discount",
    codeSkip: "Skip, no code",
    codeNone: "No code",
    codeChecking: "Checking the code…",
    codeStatus: { approved: "confirmed", pending: "waiting", switched_off: "no discount", unknown: "not recognised" },
    anchorWithout: "Without a code",
    anchorWith: "With a code",
    anchorSave: (amount) => `Save ${amount}`,
    discountNotes: {
      approved: (discount) =>
        discount ? `Well done! You save ${discount} for each student.` : "Well done! The code is confirmed: the interview fee is lower for each student.",
      pending: "This code is waiting to be confirmed. The discount applies if it is confirmed before you pay.",
      switched_off: "This code gives no discount at the moment. You can still send the form.",
      unknown: "We don't recognise this code. Check it, or send the form without it.",
      unchecked: "We couldn't check your code just now. It will still be saved with your application.",
    },
    offerTitle: "This offer is for a limited time",
    offerBody: (n) =>
      `The discount can be withdrawn at any time. Bring your ${n > 1 ? "students" : "student"} for the interview soon so you don't miss it.`,
    feeQ: "Interview fee",
    feeStudents: (n) => (n > 1 ? `${n} students` : "1 student"),
    feeTotal: "Total",
    feeWhen: "You don't pay anything on this form. You pay when you come to the school.",
    savedTotal: (amount) => `You save ${amount}`,
    offerPill: "Limited time discount",
    offerInfo: "About the limited time discount",
    sheetOffer: {
      title: "Limited time discount",
      saved: "You save",
      limited: (discount) => `The ${discount} discount for each student is for a limited time.`,
      withdrawn: "It can be withdrawn at any time, even before your interview.",
      applications: (count) => `Many families are applying: we already have ${count} applications.`,
      bring: (n) => `Bring your ${n > 1 ? "students" : "student"} for the interview this week, on a working day.`,
      ok: "OK, got it",
    },
    reviewQ: "Check, then send",
    reviewSub: "Tap Change to fix anything.",
    send: "Send application",
    sending: "Sending…",
    problems: {
      contact_name: "Enter the custodian's full name.",
      relationship: "Choose your relationship to the student.",
      relationship_description: "Describe your relationship to the student.",
      phone: "Enter your phone number.",
      phone_unreadable: "We couldn't read that phone number. Write it like 0712 345 678 or +255 712 345 678.",
      whatsapp: "We couldn't read that WhatsApp number. Write it like 0712 345 678, or leave it empty.",
      student_name: "Enter the student's full name.",
      class_name: "Choose the class the student is applying for.",
      enrollment_year: "Choose the year of enrolment.",
      year_closed: "That year no longer takes applications. Choose another year.",
      day_or_boarding: "Choose day or boarding.",
      duplicate_child: "This student is listed twice.",
      discount_code: "A discount code has only letters, numbers, - and ., up to 20. Check it, or clear it to send without a code.",
      children: "Add at least one student.",
      submission_key: "Your application changed since you first sent it. Tap Send application again.",
      payload: "We couldn't read the form. Reload the page and try again.",
    },
    duplicateChild: (name) => `${name} is on this form twice. Remove one, or correct the name.`,
    checkPending: "Wait a moment for the security check to finish, then send.",
    rateLimited: "Too many tries. Wait a few minutes, then try again. Everything you typed is still here.",
    checkFailed: "The security check didn't finish. Try sending again. Everything you typed is still here.",
    unavailable: "We couldn't receive your application just now. Everything you typed is still here; try again in a moment.",
    doneTitle: "Application received!",
    admissionNumber: "Admission Number",
    keepNumber: "Keep this number and bring it when you come to the school. You'll be asked for it.",
    keepNumbers: "Keep these numbers and bring them when you come to the school. You'll be asked for them.",
    copy: "Copy",
    copied: "Copied",
    whatsappSelf: "Send to my WhatsApp",
    whatsappText: (lines) => `Al-Rahmah Complex · Admission Number\n${lines}`,
    doneOfferTitle: (amount) => `Your ${amount} discount is waiting`,
    doneOffer: (n) => ({
      lead: "This offer is for a limited time and can be withdrawn at any time.",
      count: "Many families are applying too. Applications so far:",
      after: `So bring your ${n > 1 ? "students" : "student"} for the interview early, this week on a working day if you can.`,
    }),
    alreadySent: "This form had already been sent, so the changes you made afterwards weren't saved. Call the office to correct any details.",
    alreadySentInPart:
      "This form had already been sent, but not every student on it was received, and the changes you made afterwards weren't saved. Call the office so we can finish the application.",
    call: "Questions? Call the admissions office",
    again: "Fill in another form",
  },
}

export type FormCopy = Copy
