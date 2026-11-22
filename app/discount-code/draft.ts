// The Discount code form's draft (#503 slice 4d, prototype v63), kept in the
// tab's sessionStorage as the Admission form keeps its own (app/apply/draft.ts):
// a reload, Back, or an in-app browser that reloads after the person switches
// to WhatsApp never loses what they typed. sessionStorage only: the draft dies
// with the tab, and nothing reaches a cookie or localStorage.
//
// It holds the typed answers, the "Tayari una code?" answer, whether the
// WhatsApp box is open and which questions were answered, never the Turnstile
// token. Only "Futa fomu yote", Start over and a finished form clear it.
// Every read and write is wrapped, so with storage blocked the form works as
// it would with no draft at all.

export const DRAFT_KEY = "al-rahmah:discount-code-draft"
const VERSION = 1
const MAX_TEXT = 200
const MAX_EMAIL = 254

export const DRAFT_STEPS = ["name", "phone", "email", "has", "code", "send"] as const
export type DraftStep = (typeof DRAFT_STEPS)[number]

export type DiscountCodeDraft = {
  firstName: string
  middleName: string
  lastName: string
  phone: string
  whatsapp: string
  whatsappOn: boolean
  email: string
  codeAnswer: "yes" | "no" | null
  code: string
  // The questions answered, in the form's own names.
  answered: DraftStep[]
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const text = (value: unknown, max = MAX_TEXT) => (typeof value === "string" ? value.slice(0, max) : "")

// Reads a stored draft back into the form's shape. Anything that isn't what
// the form wrote is dropped field by field.
export function parseDraft(raw: string | null): DiscountCodeDraft | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (v.version !== VERSION) return null
  const answered = Array.isArray(v.answered)
    ? [...new Set(v.answered.filter((step): step is DraftStep => typeof step === "string" && (DRAFT_STEPS as readonly string[]).includes(step)))]
    : []
  return {
    firstName: text(v.firstName),
    middleName: text(v.middleName),
    lastName: text(v.lastName),
    phone: text(v.phone),
    whatsapp: text(v.whatsapp),
    whatsappOn: v.whatsappOn === true,
    email: text(v.email, MAX_EMAIL),
    codeAnswer: v.codeAnswer === "yes" || v.codeAnswer === "no" ? v.codeAnswer : null,
    code: text(v.code, 20),
    answered,
  }
}

export function readDraft(): DiscountCodeDraft | null {
  try {
    return parseDraft(storage()?.getItem(DRAFT_KEY) ?? null)
  } catch {
    return null
  }
}

// Whether anything is typed or picked yet. An untouched form keeps no draft.
export function isEmptyDraft(draft: DiscountCodeDraft): boolean {
  return (
    !draft.whatsappOn &&
    draft.codeAnswer === null &&
    draft.answered.length === 0 &&
    [draft.firstName, draft.middleName, draft.lastName, draft.phone, draft.whatsapp, draft.email, draft.code].every((part) => part === "")
  )
}

export function writeDraft(draft: DiscountCodeDraft) {
  try {
    const store = storage()
    if (!store) return
    if (isEmptyDraft(draft)) {
      store.removeItem(DRAFT_KEY)
      return
    }
    store.setItem(DRAFT_KEY, JSON.stringify({ version: VERSION, ...draft }))
  } catch {
    // Storage full or blocked: the form carries on without a draft.
  }
}

export function clearDraft() {
  try {
    storage()?.removeItem(DRAFT_KEY)
  } catch {
    // Blocked storage holds no draft to clear.
  }
}
