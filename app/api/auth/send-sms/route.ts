import { sendAuthSms, type AuthSmsRequest } from "@/lib/services/auth-sms"
import { smsSender } from "@/lib/services/sms"
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
// - 401 for a bad signature; 400 when the send failed (budget, limits, the
//   provider). Never 429 or 503, which Supabase retries: a retry could text
//   the same person twice.

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

  const sent = await sendAuthSms(supabase, smsSender(), payload, resetSms)
  if (sent.ok) return Response.json({})

  switch (sent.error) {
    case "phone-change":
    case "not-agent":
      console.info(`Send SMS hook: nothing sent (${sent.error})`)
      return Response.json({})
    case "invalid":
      return failed(400, "Unreadable request")
    default:
      return failed(400, `SMS not sent: ${sent.error.kind}`)
  }
}
