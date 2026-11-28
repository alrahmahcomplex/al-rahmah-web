import type { Metadata } from "next"

import { MotionProvider } from "@/components/motion-provider"

import { DesignShell } from "./design-shell"

// The design site (prototype v6), served at design.alrahmahcomplex.or.tz and
// at /design elsewhere. Every page here is static: the routing layer shows
// the lock screen to a browser without the password (lib/site-hosts.ts), so
// nothing here reads a cookie, a header or the database.
export const metadata: Metadata = {
  title: { default: "Design system · Al-Rahmah Complex", template: "%s · Al-Rahmah Complex" },
  robots: { index: false, follow: false },
}

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionProvider>
      <DesignShell>{children}</DesignShell>
    </MotionProvider>
  )
}
