import "server-only"

import type { Result } from "@/lib/services/result"

// Checks a Cloudflare Turnstile token on the server before a public form writes
// anything (#9). It fails closed: if Cloudflare can't be reached the form is
// refused, never let through.

export type TurnstileError = "missing" | "failed" | "unavailable"

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
const TIMEOUT_MS = 5000
const MAX_TOKEN_LENGTH = 2048

// Cloudflare's published test secrets (always pass, always fail, already
// spent). Their answers carry the hostname `example.com` and no action, so
// those two checks are skipped when one of them is in use.
const TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
])

// Our own setup is wrong (secret missing or rejected, request malformed): no
// token can pass, so the parent sees "try again later" and the log says why.
const CONFIG_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request"])

type Siteverify = {
  success: boolean
  "error-codes"?: string[]
  hostname?: string
  action?: string
}

type Attempt = { kind: "answer"; body: Siteverify } | { kind: "retry"; reason: string }

export async function verifyTurnstile({
  token,
  action,
  remoteIp,
  hostname,
}: {
  // As read from the form: `formData.get("cf-turnstile-response")`.
  token: FormDataEntryValue | null | undefined
  // The action the widget was rendered with, such as "admission".
  action: string
  // The client IP, from the `x-real-ip` request header.
  remoteIp: string | null | undefined
  // The request's host, from the `host` header. A port is ignored.
  hostname: string | null | undefined
}): Promise<Result<null, TurnstileError>> {
  if (typeof token !== "string" || token.trim() === "") return { ok: false, error: "missing" }
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, error: "failed" }

  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    console.error("Turnstile: TURNSTILE_SECRET_KEY is not set, so every public form is refused")
    return { ok: false, error: "unavailable" }
  }

  const request = {
    secret,
    response: token,
    ...(remoteIp ? { remoteip: remoteIp } : {}),
    // The same key on the retry lets Cloudflare answer it as the same check.
    idempotency_key: crypto.randomUUID(),
  }

  let body: Siteverify | null = null
  let lastReason = ""
  for (let attempt = 0; attempt < 2 && !body; attempt++) {
    const result = await callSiteverify(request)
    if (result.kind === "answer") body = result.body
    else lastReason = result.reason
  }
  if (!body) {
    console.error(`Turnstile: siteverify failed twice (${lastReason}), refusing the form`)
    return { ok: false, error: "unavailable" }
  }

  if (!body.success) {
    const codes = body["error-codes"] ?? []
    if (codes.some((code) => CONFIG_ERRORS.has(code))) {
      console.error(`Turnstile: siteverify rejected our request (${codes.join(", ")})`)
      return { ok: false, error: "unavailable" }
    }
    if (codes.includes("missing-input-response")) return { ok: false, error: "missing" }
    return { ok: false, error: "failed" }
  }

  if (TEST_SECRETS.has(secret)) {
    // The always-pass test secret accepts any token, so in Production it
    // would switch the check off. Refuse instead; the fix is the Vercel env.
    if (process.env.VERCEL_ENV === "production") {
      console.error("Turnstile: Production is using a Cloudflare test secret, so every public form is refused")
      return { ok: false, error: "unavailable" }
    }
    return { ok: true, data: null }
  }

  if (body.action !== action) return { ok: false, error: "failed" }
  const expectedHost = normaliseHost(hostname)
  if (!expectedHost || normaliseHost(body.hostname) !== expectedHost) return { ok: false, error: "failed" }

  return { ok: true, data: null }
}

async function callSiteverify(request: Record<string, string>): Promise<Attempt> {
  let response: Response
  try {
    response = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.name : "network error" }
  }
  if (!response.ok) return { kind: "retry", reason: `HTTP ${response.status}` }

  let body: Siteverify
  try {
    body = (await response.json()) as Siteverify
  } catch {
    return { kind: "retry", reason: "answer was not JSON" }
  }
  if (typeof body?.success !== "boolean") return { kind: "retry", reason: "answer had no success field" }
  // Cloudflare's own fault: the docs say to retry.
  if (!body.success && body["error-codes"]?.includes("internal-error")) {
    return { kind: "retry", reason: "internal-error" }
  }
  return { kind: "answer", body }
}

function normaliseHost(host: string | null | undefined) {
  if (!host) return ""
  return host.trim().toLowerCase().replace(/:\d+$/, "")
}
