"use client"

import { User } from "lucide-react"
import Link from "next/link"
import { useActionState, useState } from "react"

import { AUTH_SUBMIT, IconField, PasswordField } from "@/components/auth-fields"
import type { Language } from "@/lib/language"

import { signIn } from "./actions"
import { LOGIN_COPY, type LoginMessage, type LoginNotice } from "./copy"

export const FORGOT_PASSWORD_PATH = "/login/forgot-password"

// The one sign-in form (#264) for staff and Discount code holders. A small
// grey reset link always sits under the button; after a wrong password a
// clearer one sits under the warning instead.
export function LoginForm({ language, notice }: { language: Language; notice: LoginNotice | null }) {
  const copy = LOGIN_COPY[language]
  const [state, formAction, pending] = useActionState(signIn, null)
  const [shown, setShown] = useState(false)
  const error = state?.error ?? notice
  const message = error ? copy.messages[error] : null

  return (
    <>
      <h1 className="mb-5 text-center font-exo text-2xl font-extrabold italic text-blue-600">{copy.welcome}</h1>

      <form action={formAction} className="flex w-full flex-col gap-3">
        <IconField id="email" label={copy.email} icon={User} type="email" autoComplete="email" required />
        <PasswordField
          id="password"
          label={copy.password}
          autoComplete="current-password"
          required
          shown={shown}
          onToggle={() => setShown((value) => !value)}
          toggleLabels={{ show: copy.showPassword, hide: copy.hidePassword }}
        />

        {message && <LoginMessageView language={language} message={message} />}

        <button disabled={pending} type="submit" className={AUTH_SUBMIT}>
          {pending ? copy.processing : copy.logIn}
        </button>
      </form>

      {!message?.forgot && (
        <Link
          href={FORGOT_PASSWORD_PATH}
          className="mt-4 self-center font-exo text-[12px] text-slate-500 underline-offset-2 hover:text-blue-600 hover:underline"
        >
          {copy.forgot}
        </Link>
      )}
    </>
  )
}

function LoginMessageView({ language, message }: { language: Language; message: LoginMessage }) {
  const copy = LOGIN_COPY[language]
  return (
    <div role="alert" className="flex flex-col gap-1 text-center font-exo text-[12px] text-red-600">
      <p>{message.text}</p>
      {message.code && <p className="text-slate-500">{copy.reasonCode(message.code)}</p>}
      {message.forgot && (
        <Link href={FORGOT_PASSWORD_PATH} className="text-[13px] text-blue-600 underline underline-offset-2">
          {copy.forgot}
        </Link>
      )}
    </div>
  )
}
