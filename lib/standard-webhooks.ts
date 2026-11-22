import { createHmac, timingSafeEqual } from "node:crypto"

// Checks a Standard Webhooks signature (https://www.standardwebhooks.com),
// the way Supabase Auth signs its hooks (#503: the Send SMS hook). The secret
// is the one Supabase shows on the hook screen, "v1,whsec_<base64>". The
// signed text is "<webhook-id>.<webhook-timestamp>.<body>", HMAC-SHA256 with
// the decoded secret; webhook-signature lists one or more "v1,<base64>".
// A timestamp more than five minutes away is refused, so an old request
// can't be replayed.

const TOLERANCE_SECONDS = 5 * 60

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null }

function secretKey(secret: string): Buffer | null {
  const encoded = secret.trim().replace(/^v1,/, "").replace(/^whsec_/, "")
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
  const key = Buffer.from(encoded, "base64")
  return key.length > 0 ? key : null
}

export function signWebhook(secret: string, id: string, timestamp: number, body: string): string {
  const key = secretKey(secret)
  if (!key) throw new Error("Not a webhook secret")
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`
}

export function verifyWebhook(
  secret: string | undefined,
  headers: WebhookHeaders,
  body: string,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const key = secret ? secretKey(secret) : null
  const { id, timestamp, signature } = headers
  if (!key || !id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) return false

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest()
  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2)
    if (version !== "v1" || !value) return false
    const given = Buffer.from(value, "base64")
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
