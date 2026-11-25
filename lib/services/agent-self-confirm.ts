import "server-only"

import { createHash, createHmac, randomInt } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeTanzanianMobile, withoutPlus } from "@/lib/phone"

import { classifySendFailure, type AgentInviteSender } from "./agent-invites"
import type { Result } from "./result"
import { fitsOneSms, sendSms, type SmsSender } from "./sms"

// Agent self-confirm (#503 slice 3), switched off until slice 4. The steps
// run in the database (20270125120100_agent_self_confirm_flow.sql), with
// the secret key only; this module makes and checks the confirmation
// numbers and texts them. A number is 6 random digits; the database keeps
// only its HMAC (OTP_HMAC_SECRET, server-only), bound to its attempt.

export type StartOutcome =
  // `pendingCode`: the code the office hasn't approved yet; its attempt goes on
  // as a new agent's does (20270130120100). Null for an Approved code.
  | { kind: "ready"; attempt: string; mobileOnRecord: boolean; typedMatches: boolean; canText: boolean; emailOnRecord: boolean; emailOpen: boolean; pendingCode: string | null }
  | { kind: "off" | "access_off" | "no_match" | "name_mismatch" | "weak_names" | "joined" | "locked" | "setups_limited" | "email_closed" }

export type SendOutcome =
  | { kind: "sent"; phone: string; onRecord: boolean; show: boolean }
  | { kind: "expired" | "off" | "no_mobile" | "locked" | "too_soon" | "code_limited" | "budget_reached" | "mobile_limited" | "not_sent" }

export type CheckOutcome =
  | { kind: "right"; phone: string }
  | { kind: "wrong"; triesLeft: number }
  | { kind: "expired" | "expired_number" | "locked" | "off" | "mobile_in_use" }

export type SelfConfirmError = "unavailable" | "not-configured"

/** sha256 hex, for the browser token and the IP: the database keeps digests only. */
export function digestOf(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function numberDigest(secret: string, attempt: string, digits: string): string {
  return createHmac("sha256", secret).update(`${attempt}|${digits}`).digest("hex")
}

function hmacSecret(env: Record<string, string | undefined>): string | null {
  const secret = env.OTP_HMAC_SECRET
  return secret && secret.length >= 32 ? secret : null
}

type Row = Record<string, unknown> | null

async function call(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Result<Row, SelfConfirmError>> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    console.error(`Self-confirm: ${fn} failed`, error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: (data as Row) ?? null }
}

export async function startSelfConfirm(
  supabase: SupabaseClient,
  input: { code: string; names: string; phone: string | null; browser: string; ip: string | null },
): Promise<Result<StartOutcome, SelfConfirmError>> {
  const answer = await call(supabase, "start_agent_self_confirm", {
    code: input.code,
    typed_names: input.names,
    typed_phone: input.phone ?? "",
    browser: digestOf(input.browser),
    ip: input.ip ? digestOf(input.ip) : null,
  })
  if (!answer.ok) return answer
  const row = answer.data ?? {}
  const outcome = String(row.outcome ?? "")
  if (outcome === "ready" && typeof row.attempt === "string") {
    return {
      ok: true,
      data: {
        kind: "ready",
        attempt: row.attempt,
        mobileOnRecord: row.mobile_on_record === true,
        typedMatches: row.typed_matches === true,
        canText: row.can_text === true,
        emailOnRecord: row.email_on_record === true,
        // Closed after Remove this sign-in with its tick (#503).
        emailOpen: row.email_open !== false,
        pendingCode: row.pending === true && typeof row.code === "string" ? row.code : null,
      },
    }
  }
  const known = ["off", "access_off", "no_match", "name_mismatch", "weak_names", "joined", "locked", "setups_limited", "email_closed"] as const
  const kind = known.find((k) => k === outcome)
  if (!kind) {
    console.error("Self-confirm: unexpected start answer", row)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { kind } }
}

export type NewAgentStartOutcome =
  | { kind: "ready"; attempt: string; code: string; canText: boolean }
  | { kind: "off" | "access_off" | "code_needed" | "joined" | "setups_limited" }
  | { kind: "invalid"; field: "full_name" | "phone" | "whatsapp" }

/**
 * A brand-new agent's send while self-confirm is on (#503 slice 4d-b): today's
 * Pending record, with no email yet, and an attempt bound to this browser, so
 * they choose how to sign in as a code holder does. `supabase` holds the secret key.
 */
export async function startNewAgentSelfConfirm(
  supabase: SupabaseClient,
  input: { fullName: string; phone: string; whatsapp: string; browser: string; ip: string | null },
): Promise<Result<NewAgentStartOutcome, SelfConfirmError>> {
  const { data, error } = await supabase.rpc("start_new_agent_self_confirm", {
    full_name: input.fullName,
    phone: input.phone,
    whatsapp: input.whatsapp,
    browser: digestOf(input.browser),
    ip: input.ip ? digestOf(input.ip) : null,
  })
  if (error) {
    // agent_draft refuses a name or number it can't read, naming the field.
    const field = error.message === "invalid" ? invalidField(error.details) : null
    if (field) return { ok: true, data: { kind: "invalid", field } }
    console.error("Self-confirm: start_new_agent_self_confirm failed", error)
    return { ok: false, error: "unavailable" }
  }
  const row = (data as Row) ?? {}
  if (row.outcome === "ready" && typeof row.attempt === "string" && typeof row.code === "string") {
    return { ok: true, data: { kind: "ready", attempt: row.attempt, code: row.code, canText: row.can_text === true } }
  }
  const kind = (["off", "access_off", "code_needed", "joined", "setups_limited"] as const).find((k) => k === row.outcome)
  if (!kind) {
    console.error("Self-confirm: unexpected new-agent start answer", row)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { kind } }
}

function invalidField(details: string | null | undefined): "full_name" | "phone" | "whatsapp" | null {
  try {
    const field = (JSON.parse(details ?? "") as { field?: unknown }).field
    return field === "full_name" || field === "phone" || field === "whatsapp" ? field : null
  } catch {
    return null
  }
}

export type NewAgentEmailOutcome = { kind: "registered"; code: string; email: string } | { kind: "expired" | "off" | "no_email" | "email_unusable" }

/** A new agent's email path: the email goes on their Pending record; nothing is sent now. */
export async function setNewAgentEmail(
  supabase: SupabaseClient,
  input: { attempt: string; browser: string; email: string },
): Promise<Result<NewAgentEmailOutcome, SelfConfirmError>> {
  const answer = await call(supabase, "set_new_agent_email", { attempt: input.attempt, browser: digestOf(input.browser), typed_email: input.email })
  if (!answer.ok) return answer
  const row = answer.data ?? {}
  if (row.outcome === "registered" && typeof row.code === "string" && typeof row.email === "string") {
    return { ok: true, data: { kind: "registered", code: row.code, email: row.email } }
  }
  const kind = (["expired", "off", "no_email", "email_unusable"] as const).find((k) => k === row.outcome)
  if (!kind) {
    console.error("Self-confirm: unexpected new-agent email answer", row)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { kind } }
}

/**
 * Whether self-confirm is on, so the form asks in its order. A failed read,
 * or one slower than `waitMs` (the page waits for it), keeps today's order.
 */
export async function selfConfirmOpen(supabase: SupabaseClient, waitMs = 2000): Promise<boolean> {
  let answer
  try {
    answer = await supabase.rpc("self_confirm_open").abortSignal(AbortSignal.timeout(waitMs))
  } catch (error) {
    console.error("Self-confirm: could not read whether it is on", error)
    return false
  }
  const { data, error } = answer
  if (error) {
    console.error("Self-confirm: could not read whether it is on", error)
    return false
  }
  return data === true
}

/** The signed-in agent's own code while their record waits for the office, or null. */
export async function pendingAgentCode(supabase: SupabaseClient): Promise<Result<string | null, SelfConfirmError>> {
  const { data, error } = await supabase.rpc("my_pending_agent").maybeSingle<{ code: string }>()
  if (error) {
    console.error("Self-confirm: could not read the waiting agent's code", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: data?.code ?? null }
}

/**
 * Makes a new number for the attempt and texts it: to the mobile on record,
 * or the typed one when none is on file. A send the budget or the mobile's
 * limits refuse voids the number, so the page can offer email.
 */
export async function sendConfirmationNumber(
  supabase: SupabaseClient,
  send: SmsSender,
  input: { attempt: string; browser: string },
  message: (digits: string) => string,
  env: Record<string, string | undefined> = process.env,
): Promise<Result<SendOutcome, SelfConfirmError>> {
  const secret = hmacSecret(env)
  if (!secret) {
    console.error("Self-confirm: OTP_HMAC_SECRET must be set (32 characters or more). See .env.example.")
    return { ok: false, error: "not-configured" }
  }
  const digits = String(randomInt(0, 1_000_000)).padStart(6, "0")
  const browser = digestOf(input.browser)
  const issued = await call(supabase, "issue_agent_confirm_number", { attempt: input.attempt, browser, digest: numberDigest(secret, input.attempt, digits) })
  if (!issued.ok) return issued
  const row = issued.data ?? {}
  if (row.outcome !== "issued") {
    const kind = (["expired", "off", "no_mobile", "locked", "too_soon", "code_limited"] as const).find((k) => k === row.outcome)
    if (!kind) {
      console.error("Self-confirm: unexpected number answer", row)
      return { ok: false, error: "unavailable" }
    }
    return { ok: true, data: { kind } }
  }
  const phone = typeof row.phone === "string" ? normalizeTanzanianMobile(row.phone) : null
  if (!phone) return { ok: false, error: "unavailable" }

  const sent = await sendSms(supabase, send, { kind: "self_confirm", to: phone, agentId: typeof row.agent === "string" ? row.agent : null, message: message(digits) })
  // A Beem timeout may still deliver the SMS, so its number stays usable and
  // counted, as the reset hook keeps one.
  const delivered = sent.ok || (sent.error.kind === "provider-error" && sent.error.code === "timeout")
  if (delivered) return { ok: true, data: { kind: "sent", phone, onRecord: row.on_record === true, show: row.show === true } }
  await call(supabase, "void_agent_confirm_number", { attempt: input.attempt, browser })
  const kind = sent.error.kind === "budget-reached" ? "budget_reached" : sent.error.kind === "mobile-limited" ? "mobile_limited" : "not_sent"
  return { ok: true, data: { kind } }
}

export async function checkConfirmationNumber(
  supabase: SupabaseClient,
  input: { attempt: string; browser: string; digits: string },
  env: Record<string, string | undefined> = process.env,
): Promise<Result<CheckOutcome, SelfConfirmError>> {
  const secret = hmacSecret(env)
  if (!secret) return { ok: false, error: "not-configured" }
  if (!/^\d{6}$/.test(input.digits)) return { ok: true, data: { kind: "wrong", triesLeft: -1 } }
  const checked = await call(supabase, "check_agent_confirm_number", {
    attempt: input.attempt,
    browser: digestOf(input.browser),
    digest: numberDigest(secret, input.attempt, input.digits),
  })
  if (!checked.ok) return checked
  const row = checked.data ?? {}
  if (row.outcome === "right" && typeof row.phone === "string") return { ok: true, data: { kind: "right", phone: row.phone } }
  if (row.outcome === "wrong") return { ok: true, data: { kind: "wrong", triesLeft: Number(row.tries_left ?? 0) } }
  const kind = (["expired", "expired_number", "locked", "off", "mobile_in_use"] as const).find((k) => k === row.outcome)
  if (!kind) {
    console.error("Self-confirm: unexpected check answer", row)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { kind } }
}

export type InviteOutcome =
  | { kind: "sent"; email: string; stored: boolean }
  | { kind: "expired" | "off" | "code_limited" | "no_email" | "email_unusable" | "busy" | "email_closed" | "not_sent" }

const INVITE_RESULT = { "rate-limited": "rate_limited", "smtp-error": "smtp_error", "rejected-address": "rejected_address", "other-error": "other_error" } as const

/**
 * Email instead: today's agent invite to the email on record, or, with none,
 * to the typed one if no one else uses it. The link finishes on today's
 * /discount-code/set-password. `stored`: the email on record was used and
 * the typed one ignored.
 */
export async function sendSelfConfirmInvite(
  supabase: SupabaseClient,
  send: AgentInviteSender,
  input: { attempt: string; browser: string; email: string; hourlyBudget: number },
  redirectTo: string,
): Promise<Result<InviteOutcome, SelfConfirmError>> {
  const prepared = await call(supabase, "prepare_self_confirm_invite", {
    attempt: input.attempt,
    browser: digestOf(input.browser),
    typed_email: input.email,
    hourly_budget: input.hourlyBudget,
  })
  if (!prepared.ok) return prepared
  const row = prepared.data ?? {}
  if (row.outcome !== "ready" || typeof row.email !== "string" || typeof row.event !== "string") {
    const kind = (["expired", "off", "code_limited", "no_email", "email_unusable", "busy", "email_closed"] as const).find((k) => k === row.outcome)
    if (!kind) {
      console.error("Self-confirm: unexpected invite answer", row)
      return { ok: false, error: "unavailable" }
    }
    return { ok: true, data: { kind } }
  }
  const { error } = await send(row.email, redirectTo)
  const failure = error ? classifySendFailure(error) : null
  if (failure?.kind === "other-error") console.error("Self-confirm: the invite email could not be sent", error)
  const recorded = await supabase.rpc("record_self_confirm_invite", {
    event: row.event,
    result: failure ? INVITE_RESULT[failure.kind] : "sent",
    error_code: failure?.kind === "other-error" ? failure.code : null,
  })
  if (recorded.error) console.error("Self-confirm: could not record the invite", recorded.error)
  if (failure) return { ok: true, data: { kind: "not_sent" } }
  return { ok: true, data: { kind: "sent", email: row.email, stored: row.stored === true } }
}

export type FinishError = "password-too-short" | "not-proven" | "unavailable"

/**
 * Creates the phone login for a proven attempt. The Auth triggers accept a
 * phone-only login only when its user_metadata names a proven attempt for
 * that mobile, and link it to the attempt's agent under the agent row's
 * lock; anything else makes Auth refuse the insert, so no login is left.
 * `supabase` holds the secret key.
 */
export async function createPhoneLogin(
  supabase: SupabaseClient,
  input: { attempt: string; browser: string; phone: string; password: string },
  minimumPasswordLength: number,
): Promise<Result<{ userId: string }, FinishError>> {
  if (input.password.length < minimumPasswordLength) return { ok: false, error: "password-too-short" }
  const { data, error } = await supabase.auth.admin.createUser({
    phone: withoutPlus(input.phone),
    password: input.password,
    phone_confirm: true,
    // Read by the Auth insert triggers; Auth inserts user_metadata with the
    // row and app_metadata only after it. The browser's digest binds the
    // login to the browser that proved the attempt.
    user_metadata: { kind: "agent", self_confirm_attempt: input.attempt, self_confirm_browser: digestOf(input.browser) },
  })
  if (error || !data.user) {
    // Auth reports a refused insert as a database error; the attempt was
    // no longer proven, or the agent changed, or the mobile has a login.
    if (error && /database error/i.test(error.message)) return { ok: false, error: "not-proven" }
    console.error("Self-confirm: could not create the phone login", error)
    return { ok: false, error: "unavailable" }
  }
  // The marker has done its work at the insert; nothing reads it again, but
  // it is cleared so it never sits on the login.
  const cleared = await supabase.auth.admin.updateUserById(data.user.id, { user_metadata: { kind: "agent", self_confirm_attempt: null, self_confirm_browser: null } })
  if (cleared.error) console.error("Self-confirm: could not clear the login's marker", cleared.error)
  return { ok: true, data: { userId: data.user.id } }
}

/** Whether the signed-in agent joined through a self-confirm email invite, for the welcome's title. */
export async function joinedBySelfConfirm(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_agent_self_confirmed")
  if (error) {
    console.error("Self-confirm: could not read how the agent joined", error)
    return false
  }
  return data === true
}

/**
 * The courtesy SMS (decision 78, O-N49), after an agent joins by email
 * self-confirm: once, to the mobile on file, naming the email the account
 * opened with. `supabase` holds the secret key. Nothing to send (no mobile on
 * file, not a self-confirm invite, already sent) is not an error.
 */
export async function sendCourtesySms(
  supabase: SupabaseClient,
  send: SmsSender,
  login: string,
  message: (openedWith: string) => string,
): Promise<Result<{ sent: boolean }, "unavailable" | "too-long">> {
  const claimed = await call(supabase, "claim_self_confirm_courtesy", { login })
  if (!claimed.ok) return { ok: false, error: "unavailable" }
  const row = claimed.data ?? {}
  if (row.outcome !== "send" || typeof row.phone !== "string" || typeof row.opened_with !== "string") return { ok: true, data: { sent: false } }
  const words = message(row.opened_with)
  // A very long email can't fit one SMS; it is logged and not sent.
  if (!fitsOneSms(words)) {
    console.error("Self-confirm: the courtesy SMS doesn't fit one SMS for this email; not sent")
    return { ok: false, error: "too-long" }
  }
  const sent = await sendSms(supabase, send, { kind: "courtesy", to: row.phone, agentId: typeof row.agent === "string" ? row.agent : null, message: words })
  if (!sent.ok) {
    console.error("Self-confirm: the courtesy SMS was not sent", sent.error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { sent: true } }
}

/** The courtesy SMS words (O-N49), with the office's number as an agent dials it. */
export function courtesySms(openedWith: string, officePhone: string): string {
  return `Akaunti yako ya Al-Rahmah imefunguliwa kwa ${openedWith}. Si wewe? Piga ofisi ${officePhone}.`
}

/** The self-confirm SMS (O-N10), Swahili like the reset SMS; it fits one SMS. */
export function selfConfirmSms(digits: string): string {
  return `Al-Rahmah Complex: namba yako ya kuthibitisha ni ${digits}. Inaisha baada ya dakika 10. Usimpe mtu yeyote, hata ofisi.`
}
