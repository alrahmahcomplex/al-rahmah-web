"use server"

import { headers } from "next/headers"

import { parseAgentRegistration, referralLink, requestOrigin } from "@/lib/agent-registration"
import { checkPublicFormLimit } from "@/lib/rate-limit"
import { signUpAgent, type SignUpOutcome } from "@/lib/services/agent-sign-up"
import { verifyTurnstile } from "@/lib/turnstile"
import { publicFormClient } from "@/utils/supabase/public-form"

import type { DiscountCodeState } from "./outcome"

const MESSAGES: Record<Exclude<SignUpOutcome["kind"], "registered" | "claimed">, DiscountCodeState> = {
  code_needed: { status: "code-needed" },
  phone_mismatch: { status: "phone-mismatch" },
  no_match: { status: "no-match" },
  claim_waiting: { status: "claim-waiting" },
  invited: { status: "invited" },
  joined: { status: "joined" },
  email_unusable: { status: "email-unusable" },
  access_off: { status: "access-off" },
}

// Signs someone up for a Discount code, or records their claim on the code
// they already have (#193). In this order, so nothing is written unless
// both checks pass: the rate limit (per IP and email hash), Turnstile, the
// page's own checks, then the sign-up module, whose decision table answers
// every combination. Nothing here sends email.
export async function registerAsAgent(_previous: DiscountCodeState, formData: FormData): Promise<DiscountCodeState> {
  const requestHeaders = await headers()
  const typedEmail = formData.get("email")

  if (
    (await checkPublicFormLimit({
      headers: requestHeaders,
      key: "agent",
      subject: typeof typedEmail === "string" ? typedEmail : null,
    })) === "limited"
  ) {
    return { status: "rate-limited" }
  }

  const check = await verifyTurnstile({
    token: formData.get("cf-turnstile-response"),
    action: "agent",
    remoteIp: requestHeaders.get("x-real-ip"),
    hostname: requestHeaders.get("host"),
  })
  if (!check.ok) return { status: "check-failed" }

  const parsed = parseAgentRegistration(formData)
  if (!parsed.ok) return { status: "invalid", field: parsed.error }

  const origin = requestOrigin(requestHeaders)
  if (!origin) {
    console.error("Discount code: the request names no usable host, so no link can be made")
    return { status: "unavailable" }
  }

  let supabase
  try {
    supabase = publicFormClient()
  } catch (error) {
    console.error("Discount code: Supabase is not configured", error)
    return { status: "unavailable" }
  }
  if (!supabase) return { status: "unavailable" }

  let signedUp
  try {
    signedUp = await signUpAgent(supabase, parsed.data)
  } catch (error) {
    console.error("Discount code: signing up failed", error)
    return { status: "unavailable" }
  }
  if (!signedUp.ok) {
    return signedUp.error.kind === "invalid" ? { status: "invalid", field: signedUp.error.field } : { status: "unavailable" }
  }
  const outcome = signedUp.data
  if (outcome.kind === "registered") {
    return { status: "registered", code: outcome.code, link: referralLink(origin, outcome.code), email: outcome.email }
  }
  if (outcome.kind === "claimed") return { status: "claimed", code: outcome.code, link: referralLink(origin, outcome.code) }
  return MESSAGES[outcome.kind]
}
