import type { Metadata } from "next"

import { PORTAL_APP_METADATA } from "@/lib/portal-app"

// The cached copy of /login/forgot-password is a portal page, so it carries
// the portal's install tags like app/login/layout.tsx (#497).
export const metadata: Metadata = PORTAL_APP_METADATA

export default function LoginCopyLayout({ children }: { children: React.ReactNode }) {
  return children
}
