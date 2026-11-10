import type { Language } from "@/lib/language"

// Words for the brand top bar, its menu and the first-visit language card.
// Swahili and English from the approved prototype (concept C, v2.6 to v2.10).

export type BrandCopy = {
  /** aria-label of the logo link. */
  home: string
  /** aria-label of the menu button. */
  menu: string
  /** Label above the language control, and the control's group name. */
  language: string
  clearForm: string
  clearQuestion: string
  clearBody: string
  clearYes: string
  clearNo: string
}

export const BRAND_COPY: Record<Language, BrandCopy> = {
  sw: {
    home: "Al-Rahmah: ukurasa wa nyumbani",
    menu: "Menyu",
    language: "Lugha",
    clearForm: "Futa fomu yote",
    clearQuestion: "Futa majibu yote?",
    clearBody: "Kila jibu kwenye fomu hii litafutwa kwenye simu hii.",
    clearYes: "Ndiyo, futa",
    clearNo: "Hapana",
  },
  en: {
    home: "Al-Rahmah home page",
    menu: "Menu",
    language: "Language",
    clearForm: "Clear the whole form",
    clearQuestion: "Clear every answer?",
    clearBody: "Every answer on this form will be removed from this phone.",
    clearYes: "Yes, clear",
    clearNo: "No, keep",
  },
}

/** Each language option names itself in its own language. */
export const LANGUAGE_OPTIONS: readonly { lang: Language; label: string }[] = [
  { lang: "sw", label: "Kiswahili" },
  { lang: "en", label: "English" },
]

export const BADGE_TEXT = {
  schools: "AL-RAHMAH SCHOOLS",
  complex: "AL-RAHMAH COMPLEX",
} as const

export type BadgeVariant = keyof typeof BADGE_TEXT

/** The school's public website, opened by the logo. */
export const HOME_URL = "https://alrahmahcomplex.or.tz/"

export type LanguagePromptCopy = {
  heading: string
  body: string
  hint: string
  /** The 3-second confirmation once this language is picked. */
  status: string
}

// The card speaks Swahili until the visitor picks English. Only the
// "Continue in English" button is in English from the start.
export const LANGUAGE_PROMPT_COPY: Record<Language, LanguagePromptCopy> = {
  sw: {
    heading: "Karibu!",
    body: "Chagua lugha ya fomu hii.",
    hint: "Unaweza kubadilisha lugha baadaye kwenye Menyu.",
    status: "Fomu imewekwa kwa Kiswahili.",
  },
  en: {
    heading: "Welcome!",
    body: "Choose the language for this form.",
    hint: "You can change the language later in the Menu.",
    status: "Changing the language to English. Please wait a moment…",
  },
}

export const LANGUAGE_PROMPT_PICKS: Record<Language, string> = {
  sw: "Endelea kwa Kiswahili",
  en: "Continue in English",
}
