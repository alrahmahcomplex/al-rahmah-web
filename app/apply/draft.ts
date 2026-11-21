import { MAX_CHILDREN } from "@/lib/admission-form"
import { LAST_NAME_FROM, type LastNameFrom } from "@/lib/names"
import { DAY_OR_BOARDING, LEAD_CLASSES, RELATIONSHIPS, STUDENT_GENDERS } from "@/lib/services/leads"

// The Admission form's draft, kept in the tab's sessionStorage so Back, a
// reload, or an in-app browser that reloads after the parent switches to
// WhatsApp never loses what they typed. sessionStorage only: the draft dies
// with the tab, and nothing reaches a cookie or localStorage.
//
// The draft holds the custodian, the students, the Discount code and which
// questions the parent has answered (`done`, named by the student's place on
// the form, as `name-2`), never the Turnstile token or the submission key: a
// restored form makes a fresh key.
// Every read and write is wrapped, so with storage blocked the form works as
// it would with no draft at all.

export const DRAFT_KEY = "al-rahmah:admission-form-draft"
// 2: adds `done`, for the one-question-at-a-time form. 3: names in their
// boxes and the father switch (prototype v38, #403). A version 2 draft comes
// back with its names empty, so the form opens on the first name again and
// keeps the other answers. 4: the custodian's two buttons and the last-name
// choice (#513); a version 3 draft's father switch becomes The father.
const VERSION = 4
const SWITCH_VERSION = 3
const NAMELESS_VERSION = 2
const MAX_TEXT = 200

// Who the custodian is (#513): nobody picked yet, the first student's father,
// or someone else, whose three names are typed.
export type Custodian = "" | "father" | "other"
export const CUSTODIANS = ["father", "other"] as const

// The custodian's three names, unless `custodian` is the first student's
// father: then they stay as typed but are not sent.
export type ParentDraft = {
  firstName: string
  middleName: string
  lastName: string
  custodian: Custodian
  relationship: string
  relationshipDescription: string
  phone: string
  whatsapp: string
}
// `card` is the card's own id, so a removed card takes its entries with it.
// The student's own name and the father's three (the names contract, #400).
export type ChildDraft = {
  card: number
  firstName: string
  fatherFirst: string
  fatherMiddle: string
  fatherLast: string
  // Which of the father's names ends the student's name (#513).
  lastNameFrom: LastNameFrom
  // Boy or girl (#449). A draft from before the question comes back without
  // one, and the form opens on it.
  gender: string
  className: string
  enrollmentYear: number | null
  dayOrBoarding: string
}

// `linkCode` is the Referral link's code the page opened with when the draft
// was written (empty without one), so a reload of the same link keeps the
// parent's own edit to the code and a different link replaces it.
export type Draft = { parent: ParentDraft; children: ChildDraft[]; discountCode: string; linkCode: string; done: string[] }

export const EMPTY_PARENT: ParentDraft = {
  firstName: "",
  middleName: "",
  lastName: "",
  custodian: "",
  relationship: "",
  relationshipDescription: "",
  phone: "",
  whatsapp: "",
}

// `card` counts up within one form from 1, the same on the server and in the
// browser, so the field ids built from it match when the page hydrates.
export function emptyChild(card: number): ChildDraft {
  return { card, firstName: "", fatherFirst: "", fatherMiddle: "", fatherLast: "", lastNameFrom: "father_last", gender: "", className: "", enrollmentYear: null, dayOrBoarding: "" }
}

// A question's name in the draft: a student's (`class-3`) or the form's own.
const DONE_KEY = /^((name|gender|class|board)-[1-8]|more|pname|rel|phone|code|fee)$/
const MAX_DONE = MAX_CHILDREN * 4 + 6

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
  const { version, parent, children, discountCode, linkCode, done } = value as Record<string, unknown>
  if (version !== VERSION && version !== SWITCH_VERSION && version !== NAMELESS_VERSION) return null
  // A version 2 draft's one-box names don't split into the boxes reliably.
  const named = version !== NAMELESS_VERSION

  const p = parent && typeof parent === "object" ? (parent as Record<string, unknown>) : {}
  const name = (value: unknown) => (named ? text(value) : "")
  const names = { firstName: name(p.firstName), middleName: name(p.middleName), lastName: name(p.lastName) }
  // Version 3 had a switch: on is The father; off with a name typed is Someone else.
  const custodian: Custodian =
    version === VERSION
      ? (oneOf(p.custodian, CUSTODIANS) as Custodian)
      : named && p.fatherCustodian === true
        ? "father"
        : Object.values(names).some((part) => part.trim())
          ? "other"
          : ""
  const cleanParent: ParentDraft = {
    ...names,
    custodian,
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
      firstName: name(c.firstName),
      fatherFirst: name(c.fatherFirst),
      fatherMiddle: name(c.fatherMiddle),
      fatherLast: name(c.fatherLast),
      lastNameFrom: (oneOf(c.lastNameFrom, LAST_NAME_FROM) || "father_last") as LastNameFrom,
      gender: oneOf(c.gender, STUDENT_GENDERS),
      className: oneOf(c.className, LEAD_CLASSES),
      enrollmentYear: year,
      dayOrBoarding: oneOf(c.dayOrBoarding, DAY_OR_BOARDING),
    }
  })
  if (cleanChildren.length === 0) cleanChildren.push(emptyChild(1))

  const cleanDone = Array.isArray(done) ? done.filter((key): key is string => typeof key === "string" && DONE_KEY.test(key)).slice(0, MAX_DONE) : []

  return { parent: cleanParent, children: cleanChildren, discountCode: text(discountCode), linkCode: text(linkCode), done: cleanDone }
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
  // The last-name choice alone doesn't count: it starts as the father's last name.
  const childrenEmpty = children.every(
    (child) =>
      !child.firstName && !child.fatherFirst && !child.fatherMiddle && !child.fatherLast && !child.gender && !child.className && child.enrollmentYear === null && !child.dayOrBoarding,
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
    const { parent, children, discountCode, linkCode, done } = draft
    store.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: VERSION,
        parent,
        children: children.map(({ firstName, fatherFirst, fatherMiddle, fatherLast, lastNameFrom, gender, className, enrollmentYear, dayOrBoarding }) => ({
          firstName,
          fatherFirst,
          fatherMiddle,
          fatherLast,
          lastNameFrom,
          gender,
          className,
          enrollmentYear,
          dayOrBoarding,
        })),
        discountCode,
        linkCode,
        done,
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
