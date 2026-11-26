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
import { beginNewAgentSelfConfirm, beginSelfConfirm } from "./self-confirm-browser"

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

  // Self-confirm's order (#503 slice 4d-b) sends no email: it is asked on the
  // email path.
  const emailLater = parsed.data.email === ""
  // That email path, when it is today's claim or sign-up (owner, prototype v6
  // item 3): the email typed on it goes straight there. Self-confirm opened
  // no attempt for it, so none is started now either.
  const claimNow = formData.get("flow") === "claim"
  // A send that needs today's claim or sign-up and has no email yet: the
  // choice of how to sign in, by email only, which the office checks first.
  const officeEmail: DiscountCodeState = {
    status: "self-confirm",
    attempt: "",
    mobileOnRecord: false,
    typedMatches: false,
    canText: false,
    emailOnRecord: false,
    emailOpen: false,
    emailClaim: true,
    email: "",
    phone: parsed.data.phone,
  }

  // A brand-new agent in self-confirm's order: today's Pending record, then the
  // choice of how to sign in, as a code holder has.
  if (!parsed.data.hasCode && emailLater) {
    const started = await beginNewAgentSelfConfirm({ fullName: parsed.data.fullName, phone: parsed.data.phone, whatsapp: parsed.data.whatsapp ?? "" })
    switch (started.kind) {
      case "ready":
        return {
          status: "self-confirm",
          attempt: started.attempt,
          mobileOnRecord: true,
          typedMatches: true,
          canText: started.canText,
          emailOnRecord: false,
          emailOpen: true,
          email: "",
          phone: parsed.data.phone,
          newAgent: true,
          code: started.code,
        }
      case "invalid":
        return { status: "invalid", field: started.field }
      case "code_needed":
        return { status: "code-needed" }
      case "joined":
        return { status: "joined" }
      case "access_off":
        return { status: "access-off" }
      case "setups_limited":
        return { status: "rate-limited" }
      case "off":
        return officeEmail
      default:
        return { status: "unavailable" }
    }
  }

  // Self-confirm first (#503), for someone who has a code: a code with
  // matching names goes on to the choice of how to sign in. One the office
  // hasn't approved yet goes on as a new agent's does: its email path puts the
  // email on the record (20270130120100). Short names on the record go on too,
  // proved by the mobile on record alone, their email path today's claim
  // (20270131120100). While self-confirm is off, for short names with no SMS
  // possible, or email closed on the code (after Remove this sign-in) with no
  // mobile on record, the choice offers only today's claim by email.
  if (parsed.data.hasCode && parsed.data.code && !claimNow) {
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
          emailOpen: started.emailOpen,
          emailClaim: started.emailClaim,
          email: parsed.data.email,
          phone: parsed.data.phone,
          ...(started.pendingCode ? { newAgent: true, code: started.pendingCode } : {}),
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
      case "unavailable":
        if (emailLater) return { status: "unavailable" }
        break
    }
    // Self-confirm off, short names with no SMS possible, or email closed
    // with no mobile on record: today's claim, which needs the email.
    if (emailLater) return officeEmail
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
