import type { Metadata } from "next"

import { PORTAL_APP_METADATA } from "@/lib/portal-app"

// Sign-in and its reset pages belong to the portal, which installs as an app (#497).
export const metadata: Metadata = PORTAL_APP_METADATA

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
