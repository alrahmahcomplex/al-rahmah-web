import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"

import { AGENTS_THEME_COLOR, PORTAL_APP_METADATA, PORTAL_THEME_COLOR } from "@/lib/portal-app"
import { requestHostAudience } from "@/lib/site-hosts"

// Sign-in, its reset page and the invite page belong to the staff portal or
// the agents app depending on the host (#497, #539).
export const metadata: Metadata = PORTAL_APP_METADATA

export async function generateViewport(): Promise<Viewport> {
  const audience = requestHostAudience(await headers())
  return { themeColor: audience === "agents" ? AGENTS_THEME_COLOR : PORTAL_THEME_COLOR }
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
