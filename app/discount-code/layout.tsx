import type { Metadata } from "next"

import { PORTAL_APP_METADATA } from "@/lib/portal-app"

// Everything a Discount code agent uses belongs to the portal, which installs
// as an app (#497).
export const metadata: Metadata = PORTAL_APP_METADATA

export default function DiscountCodeLayout({ children }: { children: React.ReactNode }) {
  return children
}
