import "server-only"

import { checkFirewallRateLimit } from "@/lib/services/firewall"

// The Vercel WAF rule every public form shares (Hobby allows one). The human
// creates it in the Vercel Firewall with the `@vercel/firewall` condition and
// this ID.
const RULE_ID = "public-forms"

// Counts a public form submission against the shared `public-forms` rule, in a
// bucket per form and client IP (`admission:<ip>`, `agent:<ip>`). Pass the
// form's name as `key`; the IP comes from the request's `x-real-ip`.
//
// A request the firewall limits or blocks is `limited`. Otherwise it fails
// open: an SDK error, an unknown IP, or any run outside Vercel (local,
// Playwright) is `allowed` and logged, since Turnstile still guards the form.
export async function checkPublicFormLimit({
  headers,
  key,
}: {
  // The request headers: `await headers()` in a Server Action.
  headers: Headers
  // The form, such as "admission" or "agent".
  key: string
}): Promise<"limited" | "allowed"> {
  if (process.env.VERCEL !== "1") {
    console.warn(`Rate limit: not on Vercel, so ${key} is not rate-limited`)
    return "allowed"
  }

  const ip = headers.get("x-real-ip")
  if (!ip) {
    console.warn(`Rate limit: no client IP on the request, so ${key} is not rate-limited`)
    return "allowed"
  }

  const result = await checkFirewallRateLimit(RULE_ID, { headers, rateLimitKey: `${key}:${ip}` })
  if (!result.ok) {
    console.warn(`Rate limit: checking ${RULE_ID} failed (${result.error}), letting ${key} through`)
    return "allowed"
  }
  return result.data
}
