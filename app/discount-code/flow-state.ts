import type { DiscountCodeState } from "./outcome"

// Where the person is in choosing how to sign in (owner, prototype v5, 25 Nov
// 2026): kept in the tab's sessionStorage beside the form's draft (./draft.ts),
// so a reload on Choose, Check your SMS or Set password comes back to that
// step instead of the first question. The attempt it names is bound to this
// browser by the httpOnly "self-confirm" cookie (./self-confirm-browser.ts),
// so the id is no use anywhere else, and the server still checks every step:
// an attempt that has expired (60 minutes) or been replaced answers
// "expired" as it would without a reload. Nothing here is a secret: no
// number, no password, no token. Every read and write is wrapped, so with
// storage blocked the flow works as before, without the resume.

export const FLOW_KEY = "al-rahmah:discount-code-sign-in"
const VERSION = 1
// The attempt's own life in the database (agent_confirm_attempts.expires_at).
export const FLOW_MAX_AGE_MS = 60 * 60 * 1000

export type Started = Extract<DiscountCodeState, { status: "self-confirm" }>
export type SavedStep = { at: "choose" } | { at: "sms"; masked: string | null; onRecord: boolean; sentAt: number } | { at: "ask-email" } | { at: "password"; phone: string }
// `startedAt`: when the server opened the attempt, which lives 60 minutes from then.
export type SavedFlow = { started: Started; startedAt: number; step: SavedStep; smsOff: boolean }

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const text = (value: unknown, max: number) => (typeof value === "string" && value.length <= max ? value : null)
const flag = (value: unknown) => value === true

function parseStarted(value: unknown): Started | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const attempt = text(v.attempt, 36)
  const email = text(v.email, 254)
  const phone = text(v.phone, 200)
  if (!attempt || !UUID.test(attempt) || email === null || phone === null) return null
  const started: Started = {
    status: "self-confirm",
    attempt,
    mobileOnRecord: flag(v.mobileOnRecord),
    typedMatches: flag(v.typedMatches),
    canText: flag(v.canText),
    emailOnRecord: flag(v.emailOnRecord),
    emailOpen: flag(v.emailOpen),
    email,
    phone,
  }
  if (v.newAgent === true) {
    const code = text(v.code, 20)
    if (!code) return null
    return { ...started, newAgent: true, code }
  }
  return started
}

function parseStep(value: unknown): SavedStep | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  switch (v.at) {
    case "choose":
      return { at: "choose" }
    case "ask-email":
      return { at: "ask-email" }
    case "sms": {
      const masked = v.masked === null ? null : text(v.masked, 40)
      if (masked === null && v.masked !== null) return null
      if (typeof v.sentAt !== "number" || !Number.isFinite(v.sentAt)) return null
      return { at: "sms", masked, onRecord: flag(v.onRecord), sentAt: v.sentAt }
    }
    case "password": {
      const phone = text(v.phone, 20)
      return phone && /^\+\d{8,15}$/.test(phone) ? { at: "password", phone } : null
    }
    default:
      return null
  }
}

/** A stored flow, or null when there is none, it is too old, or it isn't what the page wrote. */
export function parseFlow(raw: string | null, now = Date.now()): SavedFlow | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (v.version !== VERSION || typeof v.startedAt !== "number" || now - v.startedAt > FLOW_MAX_AGE_MS || v.startedAt > now + 60_000) return null
  const started = parseStarted(v.started)
  const step = parseStep(v.step)
  if (!started || !step) return null
  return { started, startedAt: v.startedAt, step, smsOff: flag(v.smsOff) }
}

export function readFlow(): SavedFlow | null {
  try {
    const store = storage()
    const saved = parseFlow(store?.getItem(FLOW_KEY) ?? null)
    if (!saved) store?.removeItem(FLOW_KEY)
    return saved
  } catch {
    return null
  }
}

export function writeFlow(flow: SavedFlow) {
  try {
    storage()?.setItem(FLOW_KEY, JSON.stringify({ version: VERSION, ...flow }))
  } catch {
    // Storage full or blocked: a reload starts the form again, as before.
  }
}

export function clearFlow() {
  try {
    storage()?.removeItem(FLOW_KEY)
  } catch {
    // Blocked storage holds nothing to clear.
  }
}
