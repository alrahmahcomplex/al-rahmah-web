import "server-only"

import { checkRateLimit } from "@vercel/firewall"

import type { Result } from "@/lib/services/result"

// Asks the Vercel Firewall whether a request is over a rate-limit rule. A
// request the firewall limits or blocks is `limited`; an SDK error or a failed
// call comes back as an error for the caller to decide on.
export async function checkFirewallRateLimit(
  ruleId: string,
  { headers, rateLimitKey }: { headers: Headers; rateLimitKey: string },
): Promise<Result<"limited" | "allowed", string>> {
  try {
    const { rateLimited, error } = await checkRateLimit(ruleId, { headers, rateLimitKey })
    if (rateLimited) return { ok: true, data: "limited" }
    if (error) return { ok: false, error }
    return { ok: true, data: "allowed" }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
