"use client"

import Link from "next/link"
import { useActionState, useState } from "react"

import { ACCOUNT_COPY, type AccountMessage } from "@/app/discount-code/account-copy"
import { AccountMessageView } from "@/app/discount-code/account-message"
import { LINK_REQUEST_COPY } from "@/app/discount-code/link-request-copy"
import { ExpiredLink } from "@/app/discount-code/link-request-form"
import { AuthHeading } from "@/components/auth-card"
import { AUTH_SUBMIT, PasswordField } from "@/components/auth-fields"
import { Icon } from "@/components/icons"
import { FinishMark, Note } from "@/components/kit"
import type { Language } from "@/lib/language"
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"
import { AGENTS_ORIGIN, PORTAL_ORIGIN } from "@/lib/site-hosts"

import { LOGIN_COPY } from "../copy"
import { resetPassword, type ResetPasswordState } from "./actions"

type ErrorKey = Extract<NonNullable<ResetPasswordState>, { error: string }>["error"]

// After these the link is spent or the account can't sign in, so the form goes away.
const FINAL = new Set<ErrorKey>(["invalid-link", "deactivated", "switched-off", "retired", "access-off", "no-account"])

function messageFor(language: Language, error: Exclude<ErrorKey, "invalid-link">): AccountMessage {
  switch (error) {
    case "password-too-short":
    case "password-mismatch":
    case "password-not-saved":
    case "unavailable":
      return ACCOUNT_COPY[language].messages[error]
    default:
      // Who may sign in, worded as /auth words it.
      return LOGIN_COPY[language].messages[error]
  }
}

// The shared reset page's form (#265), for staff and agents alike. An
// expired or used link shows "Tuma kiungo kipya" instead.
export function ResetPasswordForm({
  language,
  tokenHash,
  officePhone,
}: {
  language: Language
  tokenHash: string | null
  officePhone: string
}) {
  const copy = ACCOUNT_COPY[language]
  const reset = LINK_REQUEST_COPY[language]
  const [state, formAction, pending] = useActionState(resetPassword, null)
  const [shown, setShown] = useState(false)

  if (state && "savedMoved" in state) {
    const login = LOGIN_COPY[language]
    const target = state.savedMoved
    const words = target === "agents" ? login.savedMovedAgents : login.savedMovedPortal
    const href = target === "agents" ? `${AGENTS_ORIGIN}/auth?from=moved` : `${PORTAL_ORIGIN}/auth`
    const cta = target === "agents" ? login.openAgents : login.openPortal
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <FinishMark />
        <AuthHeading>{reset.resetHeading}</AuthHeading>
        <Note tone="good">
          <span>
            {words.before}
            <b>{words.host}</b>
            {words.after}
          </span>
        </Note>
        <a href={href} className="kit-btn kit-go kit-wide !min-h-[52px] !text-[16px]">
          <span>{cta}</span>
          <Icon name="right" size={18} />
        </a>
      </div>
    )
  }

  const error: ErrorKey | null = !tokenHash ? "invalid-link" : (state?.error ?? null)

  if (error === "invalid-link") return <ExpiredLink language={language} officePhone={officePhone} />

  const message = error ? messageFor(language, error) : null
  const showForm = !(error && FINAL.has(error))

  return (
    <div className="flex flex-col">
      <AuthHeading intro={showForm ? reset.resetIntro : undefined}>{reset.resetHeading}</AuthHeading>

      {showForm ? (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="token_hash" value={tokenHash ?? ""} />
          <PasswordField
            id="password"
            label={copy.newPassword}
            autoComplete="new-password"
            required
            shown={shown}
            onToggle={() => setShown((value) => !value)}
            toggleLabels={{ show: copy.showPassword, hide: copy.hidePassword }}
            aria-describedby="password-rule"
            minLength={MINIMUM_PASSWORD_LENGTH}
          />
          <p id="password-rule" className="-mt-1 pl-4 font-exo text-[12px] text-slate-500">
            {copy.passwordRule}
          </p>
          <PasswordField
            id="confirm"
            label={copy.confirmPassword}
            autoComplete="new-password"
            required
            shown={shown}
            minLength={MINIMUM_PASSWORD_LENGTH}
          />

          {message && <AccountMessageView language={language} message={message} />}

          <button type="submit" disabled={pending} className={AUTH_SUBMIT}>
            {pending ? copy.saving : copy.setPassword}
          </button>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {message && <AccountMessageView language={language} message={message} />}
          <Link href="/auth" className="font-exo text-[13px] text-blue-600 underline underline-offset-2">
            {copy.goToSignIn}
          </Link>
        </div>
      )}
    </div>
  )
}
