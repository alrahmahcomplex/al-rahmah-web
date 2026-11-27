import "server-only"

import { checkPublicFormLimit } from "@/lib/rate-limit"

import { designPassword, isDesignPassword } from "./token"
import { designTries } from "./tries"

// The password check llms.txt and the MCP server share (design site): the
// same password as the lock screen, counted against the same wrong-try limit
// per address, so neither door lets a guesser go faster than the other. A
// wrong key also counts against the shared `public-forms` firewall rule, as
// the lock screen does, which holds across every server instance (on Vercel).

export type Access = "open" | "wrong" | "tries" | "unset"

export function addressOf(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
}

export async function checkDesignKey(given: string | null, headers: Headers): Promise<Access> {
  const password = designPassword()
  if (!password) return "unset"
  const address = addressOf(headers)
  if (designTries.blocked(address)) return "tries"
  if (isDesignPassword(given?.trim(), password)) {
    designTries.clear(address)
    return "open"
  }
  designTries.wrong(address)
  if (designTries.blocked(address)) return "tries"
  return (await checkPublicFormLimit({ headers, key: "design-key" })) === "limited" ? "tries" : "wrong"
}
