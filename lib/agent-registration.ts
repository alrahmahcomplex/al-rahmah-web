import { cleanName } from "@/components/guided-form/typing"
import type { Result } from "@/lib/services/result"
import { publicSiteOrigin } from "@/lib/site-hosts"

// The Discount code page's own rules: reading what someone typed, and the
// Referral link the confirmation hands them. Shared by the page and its Server
// Action, so both check a draft the same way. The phone's format, and
// whether a code is one, are the database's to judge (`normalize_phone`,
// `normalize_referral_code`), so here they only have to be present and
// short enough. An email is required (#193), except in self-confirm's order
// (#503 slice 4d-b), where it is asked only on the email path. The name comes in three boxes,
// First, Middle and Last, all required (v38), and is stored as one full name
// in capitals. "Do you already have a Discount code?" Yes makes the code
// required; No sends no code at all, so the database makes a new one.

export type AgentField = "full_name" | "phone" | "whatsapp" | "email" | "code"

export type AgentDraft = {
  firstName: string
  middleName: string
  lastName: string
  phone: string
  whatsapp: string
  email: string
  hasCode: boolean
  code: string
}
export type AgentRegistration = {
  fullName: string
  phone: string
  whatsapp: string | null
  email: string
  hasCode: boolean
  code: string | null
}

const MAX_PHONE_LENGTH = 40
const MAX_CODE_LENGTH = 40
const MAX_NAME_LENGTH = 100
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : ""
}

/** The three names as one full name, in capitals: what the database stores. */
export function agentFullName(draft: Pick<AgentDraft, "firstName" | "middleName" | "lastName">): string {
  return [draft.firstName, draft.middleName, draft.lastName].map(cleanName).filter(Boolean).join(" ")
}

/**
 * The three letters a new Discount code starts with, by the database's rule
 * (`marketing_agent_code_prefix`): the first letter of each of the first
 * three words when it is A to Z, then the name's next unused letters A to Z
 * in reading order, then X. JOHN DOE gives JDO.
 */
export function agentCodePrefix(fullName: string): string {
  const name = Array.from(cleanName(fullName))
  const used = new Set<number>()
  let letters = ""
  let words = 0
  name.forEach((ch, i) => {
    if (ch === " " || (i > 0 && name[i - 1] !== " ")) return
    words += 1
    if (words <= 3 && /^[A-Z]$/.test(ch)) {
      letters += ch
      used.add(i)
    }
  })
  for (let i = 0; i < name.length && letters.length < 3; i++) {
    if (!used.has(i) && /^[A-Z]$/.test(name[i])) letters += name[i]
  }
  return letters.padEnd(3, "X")
}

function read(draft: AgentDraft, { emailLater = false } = {}): Result<AgentRegistration, AgentField> {
  const parts = [draft.firstName, draft.middleName, draft.lastName].map(cleanName)
  const fullName = parts.join(" ")
  // Counted in characters, as the database counts them.
  if (parts.some((part) => part === "") || Array.from(fullName).length > MAX_NAME_LENGTH) return { ok: false, error: "full_name" }

  const phone = draft.phone.trim()
  if (!phone || phone.length > MAX_PHONE_LENGTH) return { ok: false, error: "phone" }

  const whatsapp = draft.whatsapp.trim()
  if (whatsapp.length > MAX_PHONE_LENGTH) return { ok: false, error: "whatsapp" }

  const email = draft.email.trim().toLowerCase()
  if (!(emailLater && email === "") && (email.length > 254 || !EMAIL.test(email))) return { ok: false, error: "email" }

  // No skips the code box: whatever a stale draft holds there is not sent.
  const code = draft.hasCode ? draft.code.trim() : ""
  if (code.length > MAX_CODE_LENGTH || (draft.hasCode && !code)) return { ok: false, error: "code" }

  return { ok: true, data: { fullName, phone, whatsapp: whatsapp || null, email, hasCode: draft.hasCode, code: code || null } }
}

// The page's check before sending: the field to fix, or null.
export function agentRegistrationProblem(draft: AgentDraft, options: { emailLater?: boolean } = {}): AgentField | null {
  const result = read(draft, options)
  return result.ok ? null : result.error
}

// The Server Action's reading of the posted form.
export function parseAgentRegistration(formData: FormData): Result<AgentRegistration, AgentField> {
  // `flow=self-confirm`: the form asked in self-confirm's order, with no email yet.
  return read({
    firstName: text(formData.get("firstName")),
    middleName: text(formData.get("middleName")),
    lastName: text(formData.get("lastName")),
    phone: text(formData.get("phone")),
    whatsapp: text(formData.get("whatsapp")),
    email: text(formData.get("email")),
    hasCode: formData.get("has_code") === "yes",
    code: text(formData.get("code")),
  }, { emailLater: formData.get("flow") === "self-confirm" })
}

const HOST = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\]|[a-z0-9.-]+\.localhost)(?::\d+)?$/

function first(value: string | null) {
  return value?.split(",")[0]?.trim().toLowerCase() ?? ""
}

// The origin the request came in on, so a Preview hands out Preview links and
// production hands out production ones. Null when the headers name no usable
// host.
export function requestOrigin(headers: Headers): string | null {
  const host = first(headers.get("x-forwarded-host")) || first(headers.get("host"))
  if (!host || !HOST.test(host)) return null
  const forwarded = first(headers.get("x-forwarded-proto"))
  const protocol = forwarded === "http" || forwarded === "https" ? forwarded : LOCAL_HOST.test(host) ? "http" : "https"
  return `${protocol}://${host}`
}

// The Referral link: the Admission form with the code filled in. On
// production it always names the public site, even when the agent is on the
// portal (#497).
export function referralLink(origin: string, code: string): string {
  return `${publicSiteOrigin(origin)}/apply?ref=${encodeURIComponent(code)}`
}
