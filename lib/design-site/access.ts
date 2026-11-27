import "server-only"

import { designPassword, isDesignPassword } from "./token"
import { designTries } from "./tries"

// The password check llms.txt and the MCP server share (design site): the
// same password as the lock screen, counted against the same wrong-try limit
// per address, so neither door lets a guesser go faster than the other.

export type Access = "open" | "wrong" | "tries" | "unset"

export function addressOf(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
}

export function checkDesignKey(given: string | null, headers: Headers): Access {
  const password = designPassword()
  if (!password) return "unset"
  const address = addressOf(headers)
  if (designTries.blocked(address)) return "tries"
  if (!isDesignPassword(given?.trim(), password)) {
    designTries.wrong(address)
    return designTries.blocked(address) ? "tries" : "wrong"
  }
  designTries.clear(address)
  return "open"
}
