"use server"

import { headers } from "next/headers"

import { parseAgentRegistration, referralLink, requestOrigin } from "@/lib/agent-registration"
import { checkPublicFormLimit } from "@/lib/rate-limit"
import { registerAgent } from "@/lib/services/marketing-agents"
import { verifyTurnstile } from "@/lib/turnstile"
import { publicFormClient } from "@/utils/supabase/public-form"

import type { DiscountCodeState } from "./outcome"

// Registers a would-be Marketing Agent from the Discount code page. In this
// order, so nothing is written unless both checks pass: the rate limit,
// Turnstile, the page's own checks, then the marketing-agent module. A phone
// that already holds a code gets that code back, so a retry after a dropped
// connection shows the same code.
export async function registerAsAgent(_previous: DiscountCodeState, formData: FormData): Promise<DiscountCodeState> {
  const requestHeaders = await headers()

  if ((await checkPublicFormLimit({ headers: requestHeaders, key: "agent" })) === "limited") {
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

  let registered
  try {
    registered = await registerAgent(supabase, parsed.data)
  } catch (error) {
    console.error("Discount code: registering failed", error)
    return { status: "unavailable" }
  }
  if (!registered.ok) {
    return registered.error.kind === "invalid" ? { status: "invalid", field: registered.error.field } : { status: "unavailable" }
  }
  return { status: "registered", code: registered.data.code, link: referralLink(origin, registered.data.code) }
}
