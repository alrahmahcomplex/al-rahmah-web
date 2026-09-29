import type { Metadata } from "next"

import { ConfirmForm } from "./confirm-form"

export const metadata: Metadata = {
  title: "Set your password · Al-Rahmah Complex",
}

// Where the invite email lands. Loading the page leaves the token alone, so
// an email provider's link scanner opening the link first can't use it up;
// the token is used only when the person submits their new password.
export default async function ConfirmInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>
}) {
  const { token_hash: tokenHash, type } = await searchParams
  const usable = typeof tokenHash === "string" && tokenHash !== "" && type === "invite"

  return <ConfirmForm tokenHash={usable ? tokenHash : null} />
}
