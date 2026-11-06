import type { Metadata } from "next"

import { currentSessionKind } from "@/lib/services/auth-session"
import { createClient } from "@/utils/supabase/server"

import { LoginForm, type LoginNotice } from "./login-form"

export const metadata: Metadata = {
  title: "Staff sign-in · Al-Rahmah Complex",
}

const NOTICES: readonly LoginNotice[] = ["invalid-link", "not-staff", "deactivated", "unavailable"]

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const notice = NOTICES.find((n) => n === error) ?? null

  // One account per browser: an agent signed in here must sign out first.
  const session = await currentSessionKind(await createClient())

  return <LoginForm notice={notice} agentSession={session.ok && session.data === "agent"} />
}
