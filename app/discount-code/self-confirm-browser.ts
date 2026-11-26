import "server-only"

import { randomBytes } from "node:crypto"

import { cookies, headers } from "next/headers"

import { checkClaimNames, startNewAgentSelfConfirm, startSelfConfirm, type NewAgentStartOutcome, type StartOutcome } from "@/lib/services/agent-self-confirm"
import { smsClient } from "@/utils/supabase/sms"

// The browser token that binds a self-confirm attempt to this browser (#503),
// and the start, which only registerAsAgent calls, after Turnstile and the
// form's own checks. Not a Server Action: nothing here can be called from
// the page directly.

export const BROWSER_COOKIE = "self-confirm"
export const COOKIE_PATH = "/discount-code"

export async function browserToken(create: boolean): Promise<string | null> {
  const jar = await cookies()
  const kept = jar.get(BROWSER_COOKIE)?.value
  if (kept && /^[0-9a-f]{64}$/.test(kept)) return kept
  if (!create) return null
  const token = randomBytes(32).toString("hex")
  jar.set(BROWSER_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: COOKIE_PATH, maxAge: 60 * 60 * 24 })
  return token
}

/** From registerAsAgent, after Turnstile and the form's own checks. */
export async function beginSelfConfirm(input: { code: string; names: string; phone: string | null }): Promise<StartOutcome | { kind: "unavailable" }> {
  const supabase = smsClient()
  if (!supabase) return { kind: "unavailable" }
  const browser = await browserToken(true)
  if (!browser) return { kind: "unavailable" }
  const started = await startSelfConfirm(supabase, { ...input, browser, ip: (await headers()).get("x-real-ip") })
  return started.ok ? started.data : { kind: "unavailable" }
}

/** From registerAsAgent, before today's claim from the choice's email path (flow=claim). */
export async function claimNamesCheck(input: { code: string; names: string }): Promise<"ok" | "locked" | "name_mismatch" | "unavailable"> {
  const supabase = smsClient()
  if (!supabase) return "unavailable"
  const checked = await checkClaimNames(supabase, input)
  return checked.ok ? checked.data : "unavailable"
}

/** From registerAsAgent, for a brand-new agent in self-confirm's order (#503 slice 4d-b). */
export async function beginNewAgentSelfConfirm(input: { fullName: string; phone: string; whatsapp: string }): Promise<NewAgentStartOutcome | { kind: "unavailable" }> {
  const supabase = smsClient()
  if (!supabase) return { kind: "unavailable" }
  const browser = await browserToken(true)
  if (!browser) return { kind: "unavailable" }
  const started = await startNewAgentSelfConfirm(supabase, { ...input, browser, ip: (await headers()).get("x-real-ip") })
  return started.ok ? started.data : { kind: "unavailable" }
}

