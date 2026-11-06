import "server-only"

import { headers } from "next/headers"

// Where an agent's invite links back to: the Discount code set-password page
// on the site the Manager is using, so a Preview's invites come back to that
// Preview. Next.js has already checked that a Server Action's Origin matches
// its Host. Supabase sends any address missing from its allow-list to the
// Site URL instead.
export async function agentSetPasswordUrl(): Promise<string> {
  const request = await headers()
  const host = request.get("x-forwarded-host") ?? request.get("host")
  const origin = request.get("origin") ?? `${request.get("x-forwarded-proto") ?? "https"}://${host}`
  return `${origin}/discount-code/set-password`
}
