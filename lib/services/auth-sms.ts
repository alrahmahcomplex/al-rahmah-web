import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeTanzanianMobile } from "@/lib/phone"

import type { Result } from "./result"
import { sendSms, type SmsError, type SmsSender } from "./sms"

// The SMS Supabase Auth asks for through its Send SMS hook (#503 slice 2b):
// the confirmation number of a reset by SMS. Supabase makes, stores and
// expires the number; this decides whether it goes out, and sends it through
// the school's sender with the shared budget and log (sms.ts).
//
// Only a login an agent can use right now gets one (Approved, not switched
// off or retired, agent access on), at the mobile Auth holds for it: Auth
// gives a session to whoever types the number, so a paused agent gets none. Staff
// logins carry no phone (mobile_login_guards), and nobody can sign up by
// phone, so a number with no login never reaches the hook. A phone change
// (a signed-in updateUser({ phone })) also arrives here, before the database
// refuses it: it is sent nothing, so no stranger's phone gets a code.

export type AuthSmsRequest = {
  user?: { id?: unknown; phone?: unknown; phone_change?: unknown } | null
  sms?: { otp?: unknown } | null
}

// "not-agent": no agent who can use the pages right now has this login.
export type AuthSmsRefusal = "invalid" | "phone-change" | "not-agent"

// An Auth user id: a UUID.
const LOGIN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function sendAuthSms(
  supabase: SupabaseClient,
  send: SmsSender,
  request: AuthSmsRequest,
  message: (otp: string) => string,
): Promise<Result<{ sendId: string }, AuthSmsRefusal | SmsError>> {
  const userId = typeof request.user?.id === "string" ? request.user.id : ""
  const otp = typeof request.sms?.otp === "string" ? request.sms.otp : ""
  if (!LOGIN_ID.test(userId) || !/^\d{6}$/.test(otp)) return { ok: false, error: "invalid" }
  if (typeof request.user?.phone_change === "string" && request.user.phone_change !== "") return { ok: false, error: "phone-change" }
  const phone = typeof request.user?.phone === "string" ? normalizeTanzanianMobile(request.user.phone) : null
  if (!phone) return { ok: false, error: "invalid" }

  // auth_sms_agent: the agent who may be texted for this login now, or null.
  const agent = await supabase.rpc("auth_sms_agent", { login: userId })
  if (agent.error) {
    console.error("Auth SMS: could not look up the login's agent", agent.error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const agentId = typeof agent.data === "string" ? agent.data : null
  if (!agentId) return { ok: false, error: "not-agent" }

  return sendSms(supabase, send, { kind: "reset", to: phone, agentId, message: message(otp) })
}
