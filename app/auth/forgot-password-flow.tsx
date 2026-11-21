"use client"

import { User } from "lucide-react"
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react"

import { ACCOUNT_COPY } from "@/app/discount-code/account-copy"
import { AccountMessageView } from "@/app/discount-code/account-message"
import { requestPasswordLink } from "@/app/discount-code/link-request-actions"
import { LINK_REQUEST_COPY, type LinkRequestStatus } from "@/app/discount-code/link-request-copy"
import { AuthHeading } from "@/components/auth-card"
import { AUTH_SUBMIT, IconField, PasswordField } from "@/components/auth-fields"
import { ConfirmationNumber, NoticeBox, type ConfirmationNumberHandle, type ConfirmationResult } from "@/components/guided-form"
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import type { Language } from "@/lib/language"
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"
import { readSignInLogin } from "@/lib/phone"
import type { SmsResetCheckError } from "@/lib/services/sms-reset"
import { cn } from "@/lib/utils"

import { LOGIN_COPY } from "./copy"
import { checkSmsReset, requestSmsReset, saveSmsResetPassword, type SmsRequestStatus } from "./sms-reset-actions"

// "Umesahau nenosiri?" (#194, #265), which since #503 takes an email or a
// mobile number (prototype v58, F1 to F3):
// - F1: an email gets today's reset link; a mobile gets an SMS with a
//   confirmation number. Both get a reply that never says whether there is
//   an account.
// - F2: the confirmation-number boxes, with "Tuma tena" after 60 seconds.
// - F3: a new password, then the students page.

const RESEND_SECONDS = 60
// Supabase keeps a number for 10 minutes; after that a wrong answer is
// shown as an expired one.
const NUMBER_LIFETIME_MS = 10 * 60 * 1000

type Step = { at: "start" } | { at: "sms"; phone: string; sentAt: number } | { at: "password" }

export function ForgotPasswordFlow({ language }: { language: Language }) {
  const [step, setStep] = useState<Step>({ at: "start" })
  if (step.at === "sms") {
    return <SmsStep language={language} phone={step.phone} sentAt={step.sentAt} onResent={(sentAt) => setStep({ ...step, sentAt })} onRight={() => setStep({ at: "password" })} />
  }
  if (step.at === "password") return <PasswordStep language={language} />
  return <StartStep language={language} onSms={(phone) => setStep({ at: "sms", phone, sentAt: Date.now() })} />
}

function StartStep({ language, onSms }: { language: Language; onSms: (phone: string) => void }) {
  const copy = LINK_REQUEST_COPY[language]
  const [status, setStatus] = useState<LinkRequestStatus | SmsRequestStatus | null>(null)
  const [pending, startSending] = useTransition()
  const turnstile = useRef<TurnstileWidgetHandle>(null)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    const login = readSignInLogin(String(data.get("login") ?? ""))
    if (!login) {
      setStatus("invalid-login")
      return
    }
    const token = String(data.get("cf-turnstile-response") ?? "")
    if (!token) {
      setStatus(turnstile.current?.reveal() ? null : "check-pending")
      return
    }
    setStatus(null)
    startSending(async () => {
      let result: LinkRequestStatus | SmsRequestStatus
      try {
        if ("phone" in login) {
          result = (await requestSmsReset(login.phone, token)).status
        } else {
          const linkForm = new FormData()
          linkForm.set("form", "agent-reset")
          linkForm.set("email", login.email)
          linkForm.set("cf-turnstile-response", token)
          result = (await requestPasswordLink(linkForm)).status
        }
      } catch {
        result = "unavailable"
      }
      if (result === "sent" && "phone" in login) return onSms(login.phone)
      if (result !== "sent") turnstile.current?.reset()
      setStatus(result)
    })
  }

  if (status === "sent") {
    return (
      <>
        <AuthHeading>{copy.forgotHeading}</AuthHeading>
        <p role="status" className="text-center font-exo text-[14px] text-slate-700">
          {copy.sent}
        </p>
      </>
    )
  }

  return (
    <>
      <AuthHeading intro={copy.forgotIntro}>{copy.forgotHeading}</AuthHeading>
      <form onSubmit={onSubmit} className="flex flex-col" noValidate>
        <div className="flex flex-col gap-3">
          <IconField id="forgot-login" name="login" label={copy.login} icon={User} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
          {status && <AccountMessageView language={language} message={copy.messages[status]} />}
        </div>
        <TurnstileWidget ref={turnstile} action="agent-link" language={language} className="mt-3" />
        <button type="submit" disabled={pending} className={cn(AUTH_SUBMIT, "mt-3")}>
          {pending ? copy.sending : copy.sendForgot}
        </button>
      </form>
    </>
  )
}

type CheckNote = { kind: "wrong" } | { kind: "expired" } | { kind: "message"; error: Exclude<SmsResetCheckError, "wrong-number"> }

function SmsStep({
  language,
  phone,
  sentAt,
  onResent,
  onRight,
}: {
  language: Language
  phone: string
  sentAt: number
  onResent: (sentAt: number) => void
  onRight: () => void
}) {
  const copy = LINK_REQUEST_COPY[language]
  const sms = copy.sms
  const boxes = useRef<ConfirmationNumberHandle>(null)
  const turnstile = useRef<TurnstileWidgetHandle>(null)
  const [note, setNote] = useState<CheckNote | null>(null)
  // The note for a wrong answer waits until the cross has landed.
  const pendingNote = useRef<CheckNote | null>(null)
  const [resendStatus, setResendStatus] = useState<SmsRequestStatus | null>(null)
  const [resending, startResend] = useTransition()
  const left = useCountdown(sentAt)

  async function check(code: string): Promise<ConfirmationResult> {
    setNote(null)
    let answer: Awaited<ReturnType<typeof checkSmsReset>>
    try {
      answer = await checkSmsReset(phone, code)
    } catch {
      answer = { error: "unavailable" }
    }
    if ("ok" in answer) return "ok"
    pendingNote.current =
      answer.error === "wrong-number" ? (Date.now() - sentAt > NUMBER_LIFETIME_MS ? { kind: "expired" } : { kind: "wrong" }) : { kind: "message", error: answer.error }
    return "bad"
  }
  function settled(result: ConfirmationResult) {
    if (result === "ok") return onRight()
    setNote(pendingNote.current)
  }

  function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (resending || left > 0) return
    const token = String(new FormData(event.currentTarget).get("cf-turnstile-response") ?? "")
    if (!token) {
      setResendStatus(turnstile.current?.reveal() ? null : "check-pending")
      return
    }
    setResendStatus(null)
    startResend(async () => {
      let status: SmsRequestStatus
      try {
        status = (await requestSmsReset(phone, token)).status
      } catch {
        status = "unavailable"
      }
      turnstile.current?.reset()
      if (status === "sent") {
        setNote(null)
        boxes.current?.reset()
        onResent(Date.now())
        return
      }
      setResendStatus(status)
    })
  }

  return (
    <>
      <AuthHeading intro={sms.sent}>{sms.heading}</AuthHeading>
      <div className="flex flex-col gap-3">
        <ConfirmationNumber ref={boxes} label={sms.number} digitLabel={sms.digit} onComplete={check} onSettled={settled} autoFocus />
        {note && (
          <NoticeBox role="alert" tone="info">
            {note.kind === "wrong" ? (
              <>
                {sms.wrong}
                <br />
                <button type="button" className="font-semibold text-blue-700 underline underline-offset-2" onClick={() => (setNote(null), boxes.current?.reset())}>
                  {sms.tryAgain}
                </button>
              </>
            ) : note.kind === "expired" ? (
              sms.expired
            ) : (
              messageText(language, note.error)
            )}
          </NoticeBox>
        )}
        <form onSubmit={resend} className="flex flex-col items-center" noValidate>
          <TurnstileWidget ref={turnstile} action="agent-link" language={language} className="mb-3" />
          <button
            type="submit"
            disabled={resending || left > 0}
            className="rounded-full px-4 py-2 font-exo text-[14px] font-semibold text-blue-600 underline-offset-2 enabled:hover:underline disabled:text-slate-400"
          >
            {left > 0 ? (
              <>
                {sms.sendAgainIn} <span className="tabular-nums">{formatSeconds(left)}</span>
              </>
            ) : note?.kind === "expired" ? (
              sms.sendNew
            ) : (
              sms.sendAgain
            )}
          </button>
          {resendStatus && resendStatus !== "sent" && <AccountMessageView language={language} message={copy.messages[resendStatus]} />}
        </form>
      </div>
    </>
  )
}

function messageText(language: Language, error: Exclude<SmsResetCheckError, "wrong-number">): string {
  if (error === "rate-limited" || error === "unavailable") return LINK_REQUEST_COPY[language].messages[error].text
  return LOGIN_COPY[language].messages[error].text
}

// Seconds until "Tuma tena" opens, counted from the last send.
function useCountdown(from: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return Math.min(RESEND_SECONDS, Math.max(0, Math.ceil((from + RESEND_SECONDS * 1000 - now) / 1000)))
}

function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

function PasswordStep({ language }: { language: Language }) {
  const copy = ACCOUNT_COPY[language]
  const reset = LINK_REQUEST_COPY[language]
  const [state, formAction, pending] = useActionState(saveSmsResetPassword, null)
  const [shown, setShown] = useState(false)
  const error = state?.error ?? null
  const message =
    error === null
      ? null
      : error === "password-too-short" || error === "password-mismatch" || error === "password-not-saved" || error === "unavailable"
        ? copy.messages[error]
        : error === "signed-out"
          ? LOGIN_COPY[language].messages.unavailable
          : LOGIN_COPY[language].messages[error]

  return (
    <>
      <AuthHeading intro={reset.sms.passwordIntro}>{reset.resetHeading}</AuthHeading>
      <form action={formAction} className="flex flex-col gap-3">
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
          autoFocus
        />
        <p id="password-rule" className="-mt-1 pl-4 font-exo text-[12px] text-slate-500">
          {copy.passwordRule}
        </p>
        <PasswordField id="confirm" label={copy.confirmPassword} autoComplete="new-password" required shown={shown} minLength={MINIMUM_PASSWORD_LENGTH} />
        {message && <AccountMessageView language={language} message={message} />}
        <button type="submit" disabled={pending} className={AUTH_SUBMIT}>
          {pending ? copy.saving : copy.setPassword}
        </button>
      </form>
    </>
  )
}
