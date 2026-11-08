import { MAX_CHILDREN } from "@/lib/admission-form"
import { DAY_OR_BOARDING, LEAD_CLASSES, RELATIONSHIPS } from "@/lib/services/leads"

// The Admission form's draft, kept in the tab's sessionStorage so Back, a
// reload, or an in-app browser that reloads after the parent switches to
// WhatsApp never loses what they typed. sessionStorage only: the draft dies
// with the tab, and nothing reaches a cookie or localStorage.
//
// The draft holds the parent, the children and the Discount code, never the
// Turnstile token or the submission key: a restored form makes a fresh key.
// Every read and write is wrapped, so with storage blocked the form works as
// it would with no draft at all.

export const DRAFT_KEY = "al-rahmah:admission-form-draft"
const VERSION = 1
const MAX_TEXT = 200

export type ParentDraft = { fullName: string; relationship: string; relationshipDescription: string; phone: string; whatsapp: string }
// `card` is the card's own id, so a removed card takes its entries with it.
export type ChildDraft = { card: number; fullName: string; className: string; enrollmentYear: number | null; dayOrBoarding: string }

// `linkCode` is the Referral link's code the page opened with when the draft
// was written (empty without one), so a reload of the same link keeps the
// parent's own edit to the code and a different link replaces it.
export type Draft = { parent: ParentDraft; children: ChildDraft[]; discountCode: string; linkCode: string }

export const EMPTY_PARENT: ParentDraft = { fullName: "", relationship: "", relationshipDescription: "", phone: "", whatsapp: "" }

// `card` counts up within one form from 1, the same on the server and in the
// browser, so the field ids built from it match when the page hydrates.
export function emptyChild(card: number): ChildDraft {
  return { card, fullName: "", className: "", enrollmentYear: null, dayOrBoarding: "" }
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : ""
}

function oneOf(value: unknown, allowed: readonly string[]): string {
  return typeof value === "string" && allowed.includes(value) ? value : ""
}

// Reads a stored draft back into the form's shape. Anything that isn't what
// the form wrote is dropped field by field: a class, year or choice the form
// no longer offers comes back unpicked, so the parent picks it again before
// anything is sent. Cards are numbered afresh from 1.
export function parseDraft(raw: string | null, years: readonly number[]): Draft | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== "object") return null
  const { version, parent, children, discountCode, linkCode } = value as Record<string, unknown>
  if (version !== VERSION) return null

  const p = parent && typeof parent === "object" ? (parent as Record<string, unknown>) : {}
  const cleanParent: ParentDraft = {
    fullName: text(p.fullName),
    relationship: oneOf(p.relationship, RELATIONSHIPS),
    relationshipDescription: text(p.relationshipDescription),
    phone: text(p.phone),
    whatsapp: text(p.whatsapp),
  }

  const list = Array.isArray(children) ? children.slice(0, MAX_CHILDREN) : []
  const cleanChildren: ChildDraft[] = list.map((child, index) => {
    const c = child && typeof child === "object" ? (child as Record<string, unknown>) : {}
    const year = typeof c.enrollmentYear === "number" && years.includes(c.enrollmentYear) ? c.enrollmentYear : null
    return {
      card: index + 1,
      fullName: text(c.fullName),
      className: oneOf(c.className, LEAD_CLASSES),
      enrollmentYear: year,
      dayOrBoarding: oneOf(c.dayOrBoarding, DAY_OR_BOARDING),
    }
  })
  if (cleanChildren.length === 0) cleanChildren.push(emptyChild(1))

  return { parent: cleanParent, children: cleanChildren, discountCode: text(discountCode), linkCode: text(linkCode) }
}

export function readDraft(years: readonly number[]): Draft | null {
  try {
    return parseDraft(storage()?.getItem(DRAFT_KEY) ?? null, years)
  } catch {
    return null
  }
}

// Whether the parent has typed or picked anything yet. An untouched form
// keeps no draft. The Discount code alone doesn't count: it may come from a
// Referral link, which the page fills in on its own.
export function isEmptyDraft(draft: Draft): boolean {
  const { parent, children } = draft
  const parentEmpty = Object.values(parent).every((value) => value === "")
  const childrenEmpty = children.every(
    (child) => !child.fullName && !child.className && child.enrollmentYear === null && !child.dayOrBoarding,
  )
  return parentEmpty && childrenEmpty
}

export function writeDraft(draft: Draft) {
  try {
    const store = storage()
    if (!store) return
    if (isEmptyDraft(draft)) {
      store.removeItem(DRAFT_KEY)
      return
    }
    const { parent, children, discountCode, linkCode } = draft
    store.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: VERSION,
        parent,
        children: children.map(({ fullName, className, enrollmentYear, dayOrBoarding }) => ({
          fullName,
          className,
          enrollmentYear,
          dayOrBoarding,
        })),
        discountCode,
        linkCode,
      }),
    )
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
