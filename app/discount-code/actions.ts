"use server"

import { headers } from "next/headers"

import { parseAgentRegistration, referralLink, requestOrigin } from "@/lib/agent-registration"
import { checkPublicFormLimit } from "@/lib/rate-limit"
import { signUpAgent, type SignUpOutcome } from "@/lib/services/agent-sign-up"
import { STANDARD_INTERVIEW_FEE } from "@/lib/services/discount-codes"
import { estimateDiscountCode, FORM_CODE_LOOKUP_MS } from "@/lib/services/referral"
import { verifyTurnstile } from "@/lib/turnstile"
import { publicFormClient } from "@/utils/supabase/public-form"

import type { DiscountCodeState } from "./outcome"
import { beginSelfConfirm } from "./self-confirm-browser"

const MESSAGES: Record<Exclude<SignUpOutcome["kind"], "registered" | "claimed">, DiscountCodeState> = {
  code_needed: { status: "code-needed" },
  phone_mismatch: { status: "phone-mismatch" },
  name_mismatch: { status: "name-mismatch" },
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

  // Self-confirm first (#503), for someone who has a code: an Approved code
  // with matching names goes on to the choice of how to sign in. While it is
  // off, and for a Pending code or weak record names, today's claim path.
  if (parsed.data.hasCode && parsed.data.code) {
    const started = await beginSelfConfirm({ code: parsed.data.code, names: parsed.data.fullName, phone: parsed.data.phone })
    switch (started.kind) {
      case "ready":
        return {
          status: "self-confirm",
          attempt: started.attempt,
          mobileOnRecord: started.mobileOnRecord,
          typedMatches: started.typedMatches,
          canText: started.canText,
          emailOnRecord: started.emailOnRecord,
          email: parsed.data.email,
          phone: parsed.data.phone,
        }
      case "name_mismatch":
        return { status: "name-mismatch" }
      case "no_match":
        return { status: "no-match" }
      case "joined":
        return { status: "joined" }
      case "access_off":
        return { status: "access-off" }
      case "locked":
        return { status: "self-confirm-locked" }
      case "setups_limited":
        return { status: "rate-limited" }
    }
  }

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
    const discount = await discountNow(supabase, outcome.code)
    return { status: "registered", code: outcome.code, link: referralLink(origin, outcome.code), email: outcome.email, discount }
  }
  if (outcome.kind === "claimed") {
    return { status: "claimed", code: outcome.code, link: referralLink(origin, outcome.code), discount: await discountNow(supabase, outcome.code) }
  }
  return MESSAGES[outcome.kind]
}

// What a family typing the code gets off the interview fee now, for the share
// message (#497): only an Approved code takes anything off, so a new, Pending
// code names no figure. A lookup that fails or takes longer than the Admission
// form's own wait names none either; the code is already saved.
async function discountNow(supabase: NonNullable<ReturnType<typeof publicFormClient>>, code: string): Promise<number | null> {
  try {
    const estimate = await estimateDiscountCode(supabase, code, { signal: AbortSignal.timeout(FORM_CODE_LOOKUP_MS) })
    if (!estimate.ok || estimate.data.state !== "approved") return null
    const off = STANDARD_INTERVIEW_FEE - estimate.data.amount
    return off > 0 ? off : null
  } catch {
    return null
  }
}
