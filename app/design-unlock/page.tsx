import type { Metadata } from "next"

import { BareShell } from "@/app/staff/_new-shell/bare-shell"

import { UnlockForm } from "./unlock-form"

export const metadata: Metadata = {
  title: "Design system · Al-Rahmah Complex",
  robots: { index: false, follow: false },
}

// The design site's lock screen (prototype v6), shown at the address of any
// design page to a browser without the password (lib/site-hosts.ts,
// designGateRewrites). Static, and English only.
export default function DesignUnlockPage() {
  return (
    <BareShell brandSubtitle="Design system">
      <UnlockForm />
    </BareShell>
  )
}
