import type { Metadata } from "next"

import { LoginForm, type LoginNotice } from "./login-form"

export const metadata: Metadata = {
  title: "Staff sign-in · Al-Rahmah Complex",
}

const NOTICES: readonly LoginNotice[] = ["invalid-link", "not-on-allowlist"]

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const notice = NOTICES.find((n) => n === error) ?? null

  return <LoginForm notice={notice} />
}
