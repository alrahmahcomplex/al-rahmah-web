import type { Metadata, Viewport } from "next"

import { PORTAL_APP_METADATA, PORTAL_THEME_COLOR } from "@/lib/portal-app"

// The cached copy of /auth/forgot-password for portal. (and localhost/Previews)
// carries the portal's install tags and orange theme colour (#497, #539).
export const metadata: Metadata = PORTAL_APP_METADATA

export const viewport: Viewport = { themeColor: PORTAL_THEME_COLOR }

export default function LoginCopyLayout({ children }: { children: React.ReactNode }) {
  return children
}
