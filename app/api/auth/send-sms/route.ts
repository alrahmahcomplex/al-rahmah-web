import { after } from "next/server"

import { sendAuthSms, type AuthSmsRequest } from "@/lib/services/auth-sms"
import { smsSender, type SendGate } from "@/lib/services/sms"
import { verifyWebhook } from "@/lib/standard-webhooks"
import { smsClient } from "@/utils/supabase/sms"

import { resetSms } from "./words"

// Supabase Auth's Send SMS hook (#503 slice 2b): Auth calls this instead of
// an SMS provider whenever it has a confirmation number to text, signed with
// SEND_SMS_HOOK_SECRET (Standard Webhooks). Outside proxy.ts's matcher: it
// reads no session.
//
// Answers, as Supabase expects them:
// - 200 {} when the SMS went out, and also when it is deliberately not sent
//   (a phone change, a login that isn't an agent's). Auth then tells the
//   person what it tells everyone, and nothing is retried.
// - 200 too when the send is slow but on its way: Supabase stores the
//   number only after a 200 within its 5-second hook timeout, which also
//   covers the trip here and a cold start, so the whole send (lookup,
//   reservation, Beem, log) gets 3.5 s. If by then the send has its place
//   and is with Beem, the route answers 200 and the send finishes after the
//   answer (after()), so a message Beem delivers late is still a number that
//   works. Beem itself gets 3 s. If the place isn't reserved yet, the send is
//   abandoned and the route answers 400: Supabase then keeps any earlier
//   number, which a slow refusal (a limit, the budget) must not replace.
// - 401 for a bad signature; 400 when the send failed (budget, limits, the
//   provider). Never 429 or 503, which Supabase retries: a retry could text
//   the same person twice.

const BEEM_TIMEOUT_MS = 3_000
const ANSWER_WITHIN_MS = 3_500

function failed(status: number, message: string): Response {
  return Response.json({ error: { http_code: status, message } }, { status })
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.text()
  const signed = verifyWebhook(
    process.env.SEND_SMS_HOOK_SECRET,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    body,
  )
  if (!signed) return failed(401, "Invalid signature")

  let payload: AuthSmsRequest
  try {
    payload = JSON.parse(body) as AuthSmsRequest
  } catch {
    return failed(400, "Unreadable request")
  }

  const supabase = smsClient()
  if (!supabase) return failed(400, "SMS unavailable")

  const gate: SendGate = { reserved: false, abandoned: false }
  const sending = sendAuthSms(supabase, smsSender(process.env, { timeoutMs: BEEM_TIMEOUT_MS }), payload, resetSms, gate)
  // Keeps the function alive until the send and its log are done, even when
  // the answer has gone first.
  after(() => sending.then(() => undefined))
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), ANSWER_WITHIN_MS)))
  const sent = await Promise.race([sending, late])
  clearTimeout(timer)
  if (sent === "late") {
    if (gate.reserved) {
      console.warn("Send SMS hook: still sending after 3.5 s; answered 200 so Supabase keeps the number")
      return Response.json({})
    }
    gate.abandoned = true
    console.warn("Send SMS hook: no place reserved after 3.5 s; abandoned, so Supabase keeps any earlier number")
    return failed(400, "SMS not sent: too slow")
  }
  if (sent.ok) return Response.json({})

  switch (sent.error) {
    case "phone-change":
    case "not-agent":
      console.info(`Send SMS hook: nothing sent (${sent.error})`)
      return Response.json({})
    case "invalid":
      return failed(400, "Unreadable request")
    default:
      // Beem may still deliver it: let Supabase keep the number.
      if (sent.error.kind === "provider-error" && sent.error.code === "timeout") return Response.json({})
      return failed(400, `SMS not sent: ${sent.error.kind}`)
  }
}
