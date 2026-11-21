import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeTanzanianMobile, withoutPlus } from "@/lib/phone"
import type { Result } from "@/lib/services/result"

// Every SMS the app sends (#503): confirmation numbers for self-confirm and
// resets, and the courtesy SMS to the mobile on record. The database takes a
// place in the day's budget and checks the mobile's limits first
// (reserve_sms), the sender delivers it, then the result is recorded
// (record_sms), so the log holds every send whatever happened to it.

export type SmsKind = "self_confirm" | "reset" | "courtesy"

// Delivers one message to a mobile written as 255 and nine digits, answering
// with the provider's request id or a short error code for the log.
export type SmsSender = (to: string, message: string) => Promise<Result<{ requestId: string }, string>>

// ---------------------------------------------------------------------------
// The senders. Beem Africa's send API (docs.beem.africa) with the school's
// sender name, keys from unprefixed variables so Next.js never ships them to
// a browser. Without the keys, Previews, CI and local runs get a fake that
// sends nothing and logs the message, so no test spends the school's bundle;
// Production without them refuses every send, so a missing key shows up as
// failed sends in the log instead of messages that silently never left.
// ---------------------------------------------------------------------------

const BEEM_SEND_URL = "https://apisms.beem.africa/v1/send"
const TIMEOUT_MS = 10_000

type BeemAnswer = { successful?: boolean; code?: number; request_id?: number | string }

export function beemSender(
  { apiKey, secretKey, senderId }: { apiKey: string; secretKey: string; senderId: string },
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
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      return { ok: false, error: (error as { name?: unknown } | null)?.name === "TimeoutError" ? "timeout" : "network" }
    }

    let answer: BeemAnswer | null = null
    try {
      answer = (await response.json()) as BeemAnswer
    } catch {
      answer = null
    }
    // Beem answers 100, "Message Submitted Successfully", with the request's id.
    if (response.ok && answer?.code === 100 && answer.request_id !== undefined) {
      return { ok: true, data: { requestId: String(answer.request_id) } }
    }
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

export function smsSender(env: Record<string, string | undefined> = process.env): SmsSender {
  const apiKey = env.BEEM_API_KEY
  const secretKey = env.BEEM_SECRET_KEY
  const senderId = env.BEEM_SENDER_ID
  if (apiKey && secretKey && senderId) return beemSender({ apiKey, secretKey, senderId })
  if (env.VERCEL_ENV === "production") {
    console.error("BEEM_API_KEY, BEEM_SECRET_KEY and BEEM_SENDER_ID must be set in Production to send SMS.")
    return async () => ({ ok: false, error: "beem_keys_missing" })
  }
  return fakeSender()
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

// Sends one SMS through `send` after reserving its place. `supabase` holds the
// secret key: reserve_sms and record_sms accept nothing else.
export async function sendSms(
  supabase: SupabaseClient,
  send: SmsSender,
  sms: { kind: SmsKind; to: string; agentId?: string | null; message: string },
): Promise<Result<{ sendId: string }, SmsError>> {
  const mobile = normalizeTanzanianMobile(sms.to)
  if (!mobile || sms.message.trim() === "") return { ok: false, error: { kind: "invalid" } }

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
