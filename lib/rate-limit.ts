import "server-only"

import { createHash } from "node:crypto"

import { checkFirewallRateLimit } from "@/lib/services/firewall"

// The Vercel WAF rule every public form shares (Hobby allows one). The human
// creates it in the Vercel Firewall with the `@vercel/firewall` condition and
// this ID.
const RULE_ID = "public-forms"

// Counts a public form submission against the shared `public-forms` rule, in a
// bucket per form and client IP (`code-check:<ip>`, `agent:<ip>`). Pass the
// form's name as `key`; the IP comes from the request's `x-real-ip`. With a
// `subject` (the parent's phone, the agent's email) the bucket is per person
// on that IP too, `<key>:<ip>:<hash>`, so families or agents sharing one
// connection each get their own allowance. Only a hash of the trimmed,
// lowercased subject goes into the key, never the subject itself.
//
// A request the firewall limits or blocks is `limited`. Otherwise it fails
// open: an SDK error, an unknown IP, or any run outside Vercel (local,
// Playwright) is `allowed` and logged, since Turnstile still guards the form.
export async function checkPublicFormLimit({
  headers,
  key,
  subject,
}: {
  // The request headers: `await headers()` in a Server Action.
  headers: Headers
  // The form, such as "admission" or "agent".
  key: string
  // Who is trying, already normalised by the caller; empty means IP only.
  subject?: string | null
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

  const result = await checkFirewallRateLimit(RULE_ID, { headers, rateLimitKey: rateLimitKey(key, ip, subject) })
  if (!result.ok) {
    console.warn(`Rate limit: checking ${RULE_ID} failed (${result.error}), letting ${key} through`)
    return "allowed"
  }
  return result.data
}

function rateLimitKey(key: string, ip: string, subject: string | null | undefined) {
  const person = subject?.trim().toLowerCase()
  if (!person) return `${key}:${ip}`
  return `${key}:${ip}:${createHash("sha256").update(person).digest("hex").slice(0, 32)}`
}
