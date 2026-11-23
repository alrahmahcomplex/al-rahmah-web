import type { Metadata, Viewport } from "next"

import { AGENTS_THEME_COLOR, PORTAL_APP_METADATA } from "@/lib/portal-app"

// Everything a Discount code holder uses belongs to the agents app (#539).
export const metadata: Metadata = PORTAL_APP_METADATA

export const viewport: Viewport = { themeColor: AGENTS_THEME_COLOR }

export default function DiscountCodeLayout({ children }: { children: React.ReactNode }) {
  return children
}
