"use client"

import { User } from "lucide-react"
import Link from "next/link"
import { useActionState, useEffect, useRef, useState } from "react"

import { AUTH_SUBMIT, IconField, PasswordField } from "@/components/auth-fields"
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

import { signIn, type SignInState } from "./actions"
import { LOGIN_COPY, type LoginMessage, type LoginNotice } from "./copy"

export const FORGOT_PASSWORD_PATH = "/login/forgot-password"

// The one sign-in form (#264) for staff and Discount code holders. A small
// grey reset link always sits under the button; after a wrong password a
// clearer one sits under the warning instead.
//
// Supabase checks the Turnstile token on every sign-in (#268). Until the
// widget has one, the form says so and sends nothing. The email and password
// are held here, not left to the browser, so React's reset after each press
// of Ingia doesn't clear them (#273). After a wrong password only the
// password is cleared, and the cursor goes there to type it again.
export function LoginForm({ language, notice }: { language: Language; notice: LoginNotice | null }) {
  const copy = LOGIN_COPY[language]
  const turnstile = useRef<TurnstileWidgetHandle>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [state, formAction, pending] = useActionState(async (previous: SignInState, data: FormData): Promise<SignInState> => {
    // A check that needs a click says so itself, next to Ingia.
    if (!data.get("cf-turnstile-response")) return turnstile.current?.reveal() ? null : { error: "check-pending" }
    const answer = await signIn(previous, data)
    // Supabase may have spent the token, so get a fresh one for the next try.
    if (answer?.error) turnstile.current?.reset()
    if (answer?.error === "invalid-credentials") setPassword("")
    return answer
  }, null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (state?.error === "invalid-credentials") document.getElementById("password")?.focus()
  }, [state])
  const error = state?.error ?? notice
  const message = error ? copy.messages[error] : null

  return (
    <>
      <h1 className="mb-5 text-center font-exo text-2xl font-extrabold italic text-blue-600">{copy.welcome}</h1>

      <form action={formAction} className="flex w-full flex-col">
        <div className="flex flex-col gap-3">
          <IconField
            id="email"
            label={copy.email}
            icon={User}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <PasswordField
            id="password"
            label={copy.password}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            shown={shown}
            onToggle={() => setShown((value) => !value)}
            toggleLabels={{ show: copy.showPassword, hide: copy.hidePassword }}
          />

          {message && <LoginMessageView language={language} message={message} />}
        </div>

        {/* Invisible unless Cloudflare needs a click, and then right above
            Ingia. Its spacing applies only while it shows, so the hidden
            check leaves no gap (#273). */}
        <TurnstileWidget ref={turnstile} action="sign-in" language={language} className="mt-3" />

        <button disabled={pending} type="submit" className={cn(AUTH_SUBMIT, "mt-3")}>
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
