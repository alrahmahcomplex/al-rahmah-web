import type { Result } from "@/lib/services/result"

// The Discount code page's own rules: reading what a would-be Marketing Agent
// typed, and the two links the confirmation hands them. Shared by the page
// and its Server Action, so both check a draft the same way. The phone's
// format is the database's to judge (`normalize_phone`), so here a phone only
// has to be present and short enough to be one.

export type AgentField = "full_name" | "phone" | "whatsapp"

export type AgentDraft = { fullName: string; phone: string; whatsapp: string }
export type AgentRegistration = { fullName: string; phone: string; whatsapp: string | null }

const MAX_PHONE_LENGTH = 40

function clean(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : ""
}

function read(draft: AgentDraft): Result<AgentRegistration, AgentField> {
  const fullName = clean(draft.fullName)
  // Counted in characters, as the database counts them.
  const nameLength = Array.from(fullName).length
  if (nameLength < 2 || nameLength > 100) return { ok: false, error: "full_name" }

  const phone = draft.phone.trim()
  if (!phone || phone.length > MAX_PHONE_LENGTH) return { ok: false, error: "phone" }

  const whatsapp = draft.whatsapp.trim()
  if (whatsapp.length > MAX_PHONE_LENGTH) return { ok: false, error: "whatsapp" }

  return { ok: true, data: { fullName, phone, whatsapp: whatsapp || null } }
}

// The page's check before sending: the field to fix, or null.
export function agentRegistrationProblem(draft: AgentDraft): AgentField | null {
  const result = read(draft)
  return result.ok ? null : result.error
}

// The Server Action's reading of the posted form.
export function parseAgentRegistration(formData: FormData): Result<AgentRegistration, AgentField> {
  return read({
    fullName: text(formData.get("full_name")),
    phone: text(formData.get("phone")),
    whatsapp: text(formData.get("whatsapp")),
  })
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

// The Referral link: the Admission form with the code filled in.
export function referralLink(origin: string, code: string): string {
  return `${origin}/apply?ref=${encodeURIComponent(code)}`
}

// Share on WhatsApp: WhatsApp opens with the text typed and lets the sender
// pick the chat, so there is no number in the link (#10).
export function whatsappShareLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
