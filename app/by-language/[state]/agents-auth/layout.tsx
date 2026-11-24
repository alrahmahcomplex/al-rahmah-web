import type { Metadata, Viewport } from "next"

import { AGENTS_THEME_COLOR, PORTAL_APP_METADATA } from "@/lib/portal-app"

// The cached copy of /auth/forgot-password for agents.alrahmahcomplex.or.tz
// carries the install tags and the agents app's indigo theme colour (#539, ADR 0006).
export const metadata: Metadata = PORTAL_APP_METADATA

export const viewport: Viewport = { themeColor: AGENTS_THEME_COLOR }

export default function AgentsLoginCopyLayout({ children }: { children: React.ReactNode }) {
  return children
}
