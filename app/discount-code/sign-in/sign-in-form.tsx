"use client"

import { Mail } from "lucide-react"
import Link from "next/link"
import { useActionState, useState } from "react"

import type { Language } from "@/lib/language"

import { ACCOUNT_COPY, type SignInNotice } from "../account-copy"
import { AccountMessageView } from "../account-message"
import { INPUT, PasswordField, SUBMIT } from "../password-field"
import { signInToDiscountCode } from "./actions"

export function AgentSignInForm({ language, notice }: { language: Language; notice: SignInNotice | null }) {
  const copy = ACCOUNT_COPY[language]
  const [state, formAction, pending] = useActionState(signInToDiscountCode, null)
  const [shown, setShown] = useState(false)
  const error = state?.error ?? notice
  const message = error ? copy.messages[error] : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">{copy.signInHeading}</h1>
        <p className="font-exo text-[13px] text-slate-600">{copy.signInIntro}</p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="pl-4 font-exo text-[13px] font-bold italic text-slate-700">
            {copy.email}
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <Mail className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
            </div>
            <input id="email" name="email" type="email" autoComplete="email" className={INPUT} required />
          </div>
        </div>

        <PasswordField
          id="password"
          label={copy.password}
          autoComplete="current-password"
          shown={shown}
          onToggle={() => setShown((value) => !value)}
          toggleLabels={{ show: copy.showPassword, hide: copy.hidePassword }}
        />

        {message && <AccountMessageView language={language} message={message} />}

        <button type="submit" disabled={pending} className={SUBMIT}>
          {pending ? copy.signingIn : copy.signIn}
        </button>
      </form>

      <div className="flex flex-col items-center gap-2 font-exo text-[13px]">
        {!message?.forgot && (
          <Link href="/discount-code/forgot-password" className="text-blue-600 underline underline-offset-2">
            {copy.forgot}
          </Link>
        )}
        <p className="text-center text-slate-500">{copy.helpLine}</p>
        <Link href="/login" className="text-blue-600 underline underline-offset-2">
          {copy.staffLink}
        </Link>
      </div>
    </div>
  )
}
