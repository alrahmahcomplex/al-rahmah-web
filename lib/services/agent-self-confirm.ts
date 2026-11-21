import "server-only"

import { createHash, createHmac, randomInt } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeTanzanianMobile, withoutPlus } from "@/lib/phone"

import type { Result } from "./result"
import { sendSms, type SmsSender } from "./sms"

// Agent self-confirm (#503 slice 3), switched off until slice 4. The steps
// run in the database (20270125120100_agent_self_confirm_flow.sql), with
// the secret key only; this module makes and checks the confirmation
// numbers and texts them. A number is 6 random digits; the database keeps
// only its HMAC (OTP_HMAC_SECRET, server-only), bound to its attempt.

export type StartOutcome =
  | { kind: "ready"; attempt: string; mobileOnRecord: boolean; typedMatches: boolean; canText: boolean; emailOnRecord: boolean }
  | { kind: "off" | "access_off" | "no_match" | "name_mismatch" | "weak_names" | "pending" | "joined" | "locked" | "setups_limited" }

export type SendOutcome =
  | { kind: "sent"; phone: string; onRecord: boolean }
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
      },
    }
  }
  const known = ["off", "access_off", "no_match", "name_mismatch", "weak_names", "pending", "joined", "locked", "setups_limited"] as const
  const kind = known.find((k) => k === outcome)
  if (!kind) {
    console.error("Self-confirm: unexpected start answer", row)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { kind } }
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
  if (sent.ok) return { ok: true, data: { kind: "sent", phone, onRecord: row.on_record === true } }
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
  input: { attempt: string; phone: string; password: string },
  minimumPasswordLength: number,
): Promise<Result<{ userId: string }, FinishError>> {
  if (input.password.length < minimumPasswordLength) return { ok: false, error: "password-too-short" }
  const { data, error } = await supabase.auth.admin.createUser({
    phone: withoutPlus(input.phone),
    password: input.password,
    phone_confirm: true,
    // Read by the Auth insert triggers; Auth inserts user_metadata with the
    // row and app_metadata only after it.
    user_metadata: { kind: "agent", self_confirm_attempt: input.attempt },
  })
  if (error || !data.user) {
    // Auth reports a refused insert as a database error; the attempt was
    // no longer proven, or the agent changed, or the mobile has a login.
    if (error && /database error/i.test(error.message)) return { ok: false, error: "not-proven" }
    console.error("Self-confirm: could not create the phone login", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { userId: data.user.id } }
}

/** The self-confirm SMS (O-N10), Swahili like the reset SMS; it fits one SMS. */
export function selfConfirmSms(digits: string): string {
  return `Al-Rahmah Complex: namba yako ya kuthibitisha ni ${digits}. Inaisha baada ya dakika 10. Usimpe mtu yeyote, hata ofisi.`
}
