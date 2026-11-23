import "server-only"

import { headers } from "next/headers"

import { agentsOrigin, portalOrigin } from "@/lib/site-hosts"

async function actionOrigin(): Promise<string> {
  const request = await headers()
  const host = request.get("x-forwarded-host") ?? request.get("host")
  return request.get("origin") ?? `${request.get("x-forwarded-proto") ?? "https"}://${host}`
}

// Where a staff Server Action's staff emails link back to: the portal (#497),
// or the site the Manager is using anywhere but production, so a Preview's
// invites come back to that Preview. Next.js has already checked that a
// Server Action's Origin matches its Host. Supabase sends any address missing
// from its allow-list to the Site URL instead.
export async function staffLinkOrigin(): Promise<string> {
  return portalOrigin(await actionOrigin())
}

// Where an agent's invite links back to: the Discount code set-password page
// on the agents host in production (#539), or the request's own origin elsewhere.
export async function agentSetPasswordUrl(): Promise<string> {
  return `${agentsOrigin(await actionOrigin())}/discount-code/set-password`
}
