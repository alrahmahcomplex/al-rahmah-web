import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeTanzanianMobile, withoutPlus } from "@/lib/phone"
import type { Result } from "@/lib/services/result"

// Every SMS the app sends (#503): confirmation numbers for self-confirm and
// resets, the courtesy SMS to the mobile on record, and the approval SMS to a
// new agent who signed up by mobile. The database takes a
// place in the day's budget and checks the mobile's limits first
// (reserve_sms), the sender delivers it, then the result is recorded
// (record_sms), so the log holds every send whatever happened to it.

export type SmsKind = "self_confirm" | "reset" | "courtesy" | "approved"

// Delivers one message to a mobile written as 255 and nine digits, answering
// with the provider's request id or a short error code for the log.
export type SmsSender = (to: string, message: string) => Promise<Result<{ requestId: string }, string>>

// ---------------------------------------------------------------------------
// The senders. Beem Africa's send API (docs.beem.africa) with the school's
// sender name, keys from unprefixed variables so Next.js never ships them to
// a browser. Local runs and CI ask for a fake that sends nothing and logs the
// message (smsSender below), so no test spends the school's bundle.
// ---------------------------------------------------------------------------

const BEEM_SEND_URL = "https://apisms.beem.africa/v1/send"
const TIMEOUT_MS = 10_000

type BeemAnswer = { successful?: boolean; code?: number; request_id?: number | string; valid?: number }

export function beemSender(
  { apiKey, secretKey, senderId, timeoutMs = TIMEOUT_MS }: { apiKey: string; secretKey: string; senderId: string; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): SmsSender {
  const authorization = `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString("base64")}`
  return async (to, message) => {
    let response: Response
    try {
      response = await fetchImpl(BEEM_SEND_URL, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ source_addr: senderId, encoding: 0, message, recipients: [{ recipient_id: 1, dest_addr: to }] }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      return { ok: false, error: (error as { name?: unknown } | null)?.name === "TimeoutError" ? "timeout" : "network" }
    }

    // The timeout covers reading the answer too: Beem may have taken the
    // message, so the log must say timeout, not the status line's 200.
    let answer: BeemAnswer | null = null
    try {
      answer = (await response.json()) as BeemAnswer
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "TimeoutError") return { ok: false, error: "timeout" }
      if (response.ok) return { ok: false, error: "unreadable_answer" }
      answer = null
    }
    // Beem answers 100, "Message Submitted Successfully", with the request's
    // id. Anything short of all three is not proof the message was taken.
    const requestId = answer?.request_id
    if (
      response.ok &&
      answer?.successful === true &&
      answer?.code === 100 &&
      // valid: how many recipients Beem took; none means nothing will go.
      (answer?.valid === undefined || (typeof answer.valid === "number" && answer.valid > 0)) &&
      ((typeof requestId === "number" && Number.isFinite(requestId)) || (typeof requestId === "string" && requestId.trim() !== ""))
    ) {
      return { ok: true, data: { requestId: String(requestId) } }
    }
    if (response.ok && answer?.code === 100) return { ok: false, error: "unreadable_answer" }
    if (answer?.code !== undefined) return { ok: false, error: `beem_${answer.code}` }
    return { ok: false, error: `http_${response.status}` }
  }
}

// Sends nothing; logs where the message would have gone, for local runs.
export function fakeSender(log: (line: string) => void = console.info): SmsSender {
  let n = 0
  return async (to, message) => {
    n += 1
    log(`[fake SMS ${n}] to ${to}: ${message}`)
    return { ok: true, data: { requestId: `fake-${n}` } }
  }
}

// Whether this server talks to a Supabase on this machine: local runs and
// CI's test jobs do; every deployment talks to the hosted project.
function localSupabase(url: string | undefined): boolean {
  try {
    return url !== undefined && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

// Beem with all three keys. The fake only where it is asked for by name
// (SMS_FAKE=1: .env.example for local runs, CI's test jobs) and the database
// is a local one, so no deployment can ever fake, whatever its environment
// variables say. Anything else, a deployment that lost a key included,
// refuses every send, so a missing key shows up as failed sends in the log
// rather than as numbers that silently never left.
// timeoutMs: the Send SMS hook passes a shorter one, so it answers Supabase
// within Supabase's own hook timeout (5 s).
export function smsSender(env: Record<string, string | undefined> = process.env, { timeoutMs }: { timeoutMs?: number } = {}): SmsSender {
  const apiKey = env.BEEM_API_KEY
  const secretKey = env.BEEM_SECRET_KEY
  const senderId = env.BEEM_SENDER_ID
  if (apiKey && secretKey && senderId) return beemSender({ apiKey, secretKey, senderId, timeoutMs })
  if (env.SMS_FAKE === "1" && env.VERCEL_ENV !== "production" && localSupabase(env.NEXT_PUBLIC_SUPABASE_URL)) return fakeSender()
  console.error("BEEM_API_KEY, BEEM_SECRET_KEY and BEEM_SENDER_ID must be set to send SMS (or SMS_FAKE=1 outside Production).")
  return async () => ({ ok: false, error: "beem_keys_missing" })
}

// ---------------------------------------------------------------------------
// One SMS, one place in the budget: a message must fit one GSM-7 segment,
// 160 characters, with the extension characters counting two. Anything else
// would cost more than one SMS (or go as UCS-2 at 70), so it is refused
// before anything is reserved.
// ---------------------------------------------------------------------------

const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
)
const GSM7_EXTENSION = new Set("\f^{}\\[~]|€")
const ONE_SEGMENT = 160

// The message's length in GSM-7 septets, or null if it needs another encoding.
export function gsm7Length(message: string): number | null {
  let length = 0
  for (const char of message) {
    if (GSM7_BASIC.has(char)) length += 1
    else if (GSM7_EXTENSION.has(char)) length += 2
    else return null
  }
  return length
}

export function fitsOneSms(message: string): boolean {
  const length = gsm7Length(message)
  return length !== null && length > 0 && length <= ONE_SEGMENT && message.trim() !== ""
}

// ---------------------------------------------------------------------------
// Sending, with the budget and the log.
// ---------------------------------------------------------------------------

export type SmsError =
  | { kind: "invalid" }
  | { kind: "budget-reached" }
  | { kind: "mobile-limited" }
  | { kind: "provider-error"; code: string }
  | { kind: "unavailable" }

type Reservation = { outcome?: string; send_id?: string }

// Shared with a caller that stops waiting (the Send SMS hook): `reserved`
// turns true once the send has its place and goes to the provider;
// `abandoned`, set by the caller, stops a send that has neither yet.
export type SendGate = { reserved: boolean; abandoned: boolean }

// Sends one SMS through `send` after reserving its place. `supabase` holds the
// secret key: reserve_sms and record_sms accept nothing else.
export async function sendSms(
  supabase: SupabaseClient,
  send: SmsSender,
  sms: { kind: SmsKind; to: string; agentId?: string | null; message: string },
  gate?: SendGate,
): Promise<Result<{ sendId: string }, SmsError>> {
  const mobile = normalizeTanzanianMobile(sms.to)
  if (!mobile || !fitsOneSms(sms.message)) return { ok: false, error: { kind: "invalid" } }
  if (gate?.abandoned) return { ok: false, error: { kind: "unavailable" } }

  const reserved = await supabase.rpc("reserve_sms", { kind: sms.kind, to_phone: mobile, agent_id: sms.agentId ?? null })
  if (reserved.error) {
    console.error("Could not reserve an SMS", reserved.error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const row = reserved.data as Reservation | null
  if (row?.outcome === "budget_reached") return { ok: false, error: { kind: "budget-reached" } }
  if (row?.outcome === "mobile_limited") return { ok: false, error: { kind: "mobile-limited" } }
  if (row?.outcome !== "reserved" || !row.send_id) {
    console.error("Unexpected SMS reservation", row)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const sendId = row.send_id
  // Abandoned while reserving: never sent, and recorded as not sent. The
  // place stays counted, as a provider error's does.
  if (gate?.abandoned) {
    const recorded = await supabase.rpc("record_sms", { send_id: sendId, result: "provider_error", provider_request_id: null, error_code: "abandoned" })
    if (recorded.error) console.error("Could not record an SMS", sendId, recorded.error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  if (gate) gate.reserved = true

  let delivered: Result<{ requestId: string }, string>
  try {
    delivered = await send(withoutPlus(mobile), sms.message)
  } catch (error) {
    console.error("The SMS sender threw", error)
    delivered = { ok: false, error: "sender_threw" }
  }

  // The SMS has gone (or not) either way, so a failure to record is logged,
  // not reported as the send's result.
  const recorded = await supabase.rpc("record_sms", {
    send_id: sendId,
    result: delivered.ok ? "sent" : "provider_error",
    provider_request_id: delivered.ok ? delivered.data.requestId : null,
    error_code: delivered.ok ? null : delivered.error,
  })
  if (recorded.error) console.error("Could not record an SMS", sendId, recorded.error)

  if (!delivered.ok) {
    console.error("An SMS could not be sent", sendId, delivered.error)
    return { ok: false, error: { kind: "provider-error", code: delivered.error } }
  }
  return { ok: true, data: { sendId } }
}
