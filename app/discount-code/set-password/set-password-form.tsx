"use client"

import Link from "next/link"
import { useActionState, useState } from "react"

import { AuthHeading } from "@/components/auth-card"
import { AUTH_SUBMIT, PasswordField } from "@/components/auth-fields"
import type { Language } from "@/lib/language"
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"

import { ACCOUNT_COPY } from "../account-copy"
import { AccountMessageView } from "../account-message"
import { LINK_REQUEST_COPY } from "../link-request-copy"
import { ExpiredLink } from "../link-request-form"
import { setAgentPassword, type SetAgentPasswordState } from "./actions"

type ErrorKey = NonNullable<SetAgentPasswordState>["error"]

// Errors after which the link is spent or can't be used here, so the form goes away.
const FINAL = new Set<ErrorKey>(["invalid-link", "switched-off", "retired", "access-off", "not-agent", "joined-unavailable"])

// For the invite link (`invite`) and, from #194, the reset link (`recovery`).
// A link that has expired or was used shows "Tuma kiungo kipya" instead.
export function SetPasswordForm({
  language,
  tokenHash,
  linkType,
  officePhone,
}: {
  language: Language
  tokenHash: string | null
  linkType: "invite" | "recovery"
  officePhone: string
}) {
  const copy = ACCOUNT_COPY[language]
  const reset = LINK_REQUEST_COPY[language]
  const [state, formAction, pending] = useActionState(setAgentPassword, null)
  const [shown, setShown] = useState(false)
  const error: ErrorKey | null = !tokenHash ? "invalid-link" : (state?.error ?? null)
  const message = error ? copy.messages[error] : null
  const showForm = tokenHash !== null && !(error && FINAL.has(error))

  if (error === "invalid-link") return <ExpiredLink language={language} officePhone={officePhone} />

  return (
    <div className="flex flex-col">
      <AuthHeading intro={showForm ? (linkType === "recovery" ? reset.resetIntro : copy.setPasswordIntro) : undefined}>
        {linkType === "recovery" ? reset.resetHeading : copy.setPasswordHeading}
      </AuthHeading>

      {showForm ? (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="token_hash" value={tokenHash ?? ""} />
          <input type="hidden" name="type" value={linkType} />
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
          {!message?.signIn && (
            <Link href="/login" className="font-exo text-[13px] text-blue-600 underline underline-offset-2">
              {copy.goToSignIn}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
