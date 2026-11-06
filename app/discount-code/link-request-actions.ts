"use server"

import { headers } from "next/headers"
import { after } from "next/server"

import { requestOrigin } from "@/lib/agent-registration"
import { checkPublicFormLimit } from "@/lib/rate-limit"
import { decideAgentLink, readLinkLimits, sendAgentLink } from "@/lib/services/agent-link-requests"
import { verifyTurnstile } from "@/lib/turnstile"
import { agentInviteSender, agentResetSender } from "@/utils/supabase/admin"
import { publicFormClient } from "@/utils/supabase/public-form"

import type { LinkRequestStatus } from "./link-request-copy"

// The forms that ask for a link, each with its own firewall key.
const FORMS = new Set(["agent-reset", "agent-new-link"])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// "Umesahau nenosiri?" and "Tuma kiungo kipya" (#194). In this order:
// Turnstile, the firewall key (`<form>:<ip>:<email hash>`), then the
// database's access switch, per-email limit and hourly budget. Supabase's
// own 60-second gap per address applies to the send. If the firewall check
// fails open, the database limits still hold.
//
// Any outcome that might send gets the same reply, and the email goes out
// after the reply, so neither the words nor the wait tell a stranger whether
// the email has an account.
export async function requestPasswordLink(formData: FormData): Promise<{ status: LinkRequestStatus }> {
  const form = String(formData.get("form") ?? "")
  if (!FORMS.has(form)) return { status: "unavailable" }
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
  if (email.length > 254 || !EMAIL.test(email)) return { status: "invalid-email" }

  const requestHeaders = await headers()
  const check = await verifyTurnstile({
    token: formData.get("cf-turnstile-response"),
    action: "agent-link",
    remoteIp: requestHeaders.get("x-real-ip"),
    hostname: requestHeaders.get("host"),
  })
  if (!check.ok) return { status: "check-failed" }

  if ((await checkPublicFormLimit({ headers: requestHeaders, key: form, subject: email })) === "limited") {
    return { status: "rate-limited" }
  }

  const origin = requestOrigin(requestHeaders)
  const supabase = publicFormClient()
  if (!origin || !supabase) {
    if (!origin) console.error("Password link: the request names no usable host, so no link can be made")
    return { status: "unavailable" }
  }

  const decided = await decideAgentLink(supabase, email, readLinkLimits())
  if (!decided.ok) return { status: "unavailable" }
  const decision = decided.data
  switch (decision.kind) {
    case "access-off":
      return { status: "access-off" }
    case "limited":
    case "busy":
      return { status: "rate-limited" }
    case "none":
      return { status: "sent" }
  }

  const redirects = { reset: `${origin}/discount-code/reset-password`, invite: `${origin}/discount-code/set-password` }
  after(async () => {
    try {
      await sendAgentLink(supabase, { reset: agentResetSender(), invite: agentInviteSender() }, redirects, decision)
    } catch (error) {
      console.error("Password link: sending failed", error)
    }
  })
  return { status: "sent" }
}
