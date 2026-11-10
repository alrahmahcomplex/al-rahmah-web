"use client"

import { Eye, EyeOff, Lock } from "lucide-react"
import Link from "next/link"
import { useActionState, useState, type InputHTMLAttributes } from "react"

import { ContinuePill, FieldInput, Hint } from "@/components/guided-form"
import type { Language } from "@/lib/language"
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"

import { ACCOUNT_COPY } from "../account-copy"
import { AccountMessageView } from "../account-message"
import { ExpiredLink } from "../link-request-form"
import { setAgentPassword, type SetAgentPasswordState } from "./actions"

type ErrorKey = NonNullable<SetAgentPasswordState>["error"]

// Errors after which the link is spent or can't be used here, so the form goes away.
const FINAL = new Set<ErrorKey>(["invalid-link", "switched-off", "retired", "access-off", "not-agent", "joined-unavailable"])

const HEADING = "font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic"

// For the invite link. Reset links land on the shared reset page (#265). A
// link that has expired or was used shows "Tuma kiungo kipya" instead.
export function SetPasswordForm({
  language,
  tokenHash,
  officePhone,
}: {
  language: Language
  tokenHash: string | null
  officePhone: string
}) {
  const copy = ACCOUNT_COPY[language]
  const [state, formAction, pending] = useActionState(setAgentPassword, null)
  const [shown, setShown] = useState(false)
  const error: ErrorKey | null = !tokenHash ? "invalid-link" : (state?.error ?? null)
  const message = error ? copy.messages[error] : null
  const showForm = tokenHash !== null && !(error && FINAL.has(error))

  if (error === "invalid-link") return <ExpiredLink language={language} officePhone={officePhone} guided />

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 text-center">
        <h2 className={HEADING}>{copy.setPasswordHeading}</h2>
        {showForm && <p className="text-[15px] text-slate-600">{copy.setPasswordIntro}</p>}
      </div>

      {showForm ? (
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="token_hash" value={tokenHash ?? ""} />
          <div className="flex flex-col gap-1.5">
            <PasswordInput
              id="password"
              label={copy.newPassword}
              shown={shown}
              toggle={{ onToggle: () => setShown((value) => !value), show: copy.showPassword, hide: copy.hidePassword }}
              aria-describedby="password-rule"
            />
            <Hint id="password-rule" className="pl-5">
              {copy.passwordRule}
            </Hint>
          </div>
          <PasswordInput id="confirm" label={copy.confirmPassword} shown={shown} />

          {message && <AccountMessageView language={language} message={message} />}

          <ContinuePill type="submit" pending={pending} disabled={pending}>
            {pending ? copy.saving : copy.setPassword}
          </ContinuePill>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {message && <AccountMessageView language={language} message={message} />}
          {!message?.signIn && (
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-full px-2.5 text-[15px] font-semibold text-blue-600 underline decoration-blue-600/35 underline-offset-4"
            >
              {copy.goToSignIn}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

// A password pill with a visible label. With `toggle`, it carries the
// show/hide eye; `shown` belongs to the form, so both boxes show or hide
// together.
function PasswordInput({
  id,
  label,
  shown,
  toggle,
  ...input
}: {
  id: string
  label: string
  shown: boolean
  toggle?: { onToggle: () => void; show: string; hide: string }
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type">) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold text-slate-800">
        {label}
      </label>
      <div className="relative">
        <FieldInput
          id={id}
          name={id}
          type={shown ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={MINIMUM_PASSWORD_LENGTH}
          alignStart
          icon={<Lock className="size-5" strokeWidth={1.75} aria-hidden />}
          {...input}
        />
        {toggle && (
          <button
            type="button"
            onClick={toggle.onToggle}
            aria-label={shown ? toggle.hide : toggle.show}
            aria-pressed={shown}
            className="absolute inset-y-0 right-1 my-auto grid size-11 place-items-center rounded-full text-slate-500 outline-none hover:text-slate-700 focus-visible:ring-3 focus-visible:ring-blue-600/40"
          >
            {shown ? <EyeOff className="size-5" strokeWidth={1.75} aria-hidden /> : <Eye className="size-5" strokeWidth={1.75} aria-hidden />}
          </button>
        )}
      </div>
    </div>
  )
}
