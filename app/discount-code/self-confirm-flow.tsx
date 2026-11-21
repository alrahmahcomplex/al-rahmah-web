"use client"

import { Lock } from "lucide-react"
import { useActionState, useEffect, useRef, useState, useTransition } from "react"

import {
  ChoiceTiles,
  ConfirmationNumber,
  ContinuePill,
  FieldInput,
  NoticeBox,
  QuestionTitle,
  type ConfirmationNumberHandle,
  type ConfirmationResult,
} from "@/components/guided-form"
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import type { Language } from "@/lib/language"
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"
import { cn } from "@/lib/utils"

import { CARD } from "./frame"
import type { DiscountCodeState } from "./outcome"
import { SELF_CONFIRM_COPY } from "./self-confirm-copy"
import {
  checkSelfConfirmNumber,
  finishSelfConfirm,
  sendSelfConfirmEmail,
  sendSelfConfirmNumber,
  type CheckStatus,
  type NumberStatus,
} from "./self-confirm-actions"

// Self-confirm (#503 slice 3, prototype v58 states 2 to 5 and E1 to E8),
// after the code and names have matched: the agent chooses how to sign in.
// By mobile, a confirmation number to the mobile on record (or the typed
// one when none is on file), then a password; by email, today's invite.

type Started = Extract<DiscountCodeState, { status: "self-confirm" }>
type Step = { at: "choose" } | { at: "sms"; masked: string | null; onRecord: boolean; sentAt: number } | { at: "email"; email: string } | { at: "password"; phone: string } | { at: "mobile-used" }

const RESEND_SECONDS = 60
const TITLE = "font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic outline-none"

export function SelfConfirmFlow({ language, started, onChangeEmail }: { language: Language; started: Started; onChangeEmail: () => void }) {
  const copy = SELF_CONFIRM_COPY[language]
  const [step, setStep] = useState<Step>({ at: "choose" })
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, startWork] = useTransition()
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => heading.current?.focus({ preventScroll: true }), [step.at])

  const numberProblem = (status: NumberStatus["status"]): string =>
    status === "locked" ? copy.locked : status === "limited" ? copy.limited : status === "unavailable" ? copy.unavailable : copy.expired

  function sendNumber() {
    setProblem(null)
    startWork(async () => {
      let sent: NumberStatus
      try {
        sent = await sendSelfConfirmNumber(started.attempt)
      } catch {
        sent = { status: "unavailable" }
      }
      if (sent.status === "sent") return setStep({ at: "sms", masked: sent.onRecord && !started.typedMatches ? null : sent.masked, onRecord: sent.onRecord, sentAt: Date.now() })
      if (sent.status === "no-sms") return emailInstead()
      setProblem(numberProblem(sent.status))
    })
  }

  function emailInstead() {
    setProblem(null)
    startWork(async () => {
      try {
        const sent = await sendSelfConfirmEmail(started.attempt, started.email)
        if (sent.status === "sent") return setStep({ at: "email", email: sent.email })
        setProblem(sent.status === "email-unusable" ? copy.emailUnusable : sent.status === "no-email" ? copy.noEmail : sent.status === "limited" ? copy.limited : copy.unavailable)
      } catch {
        setProblem(copy.unavailable)
      }
    })
  }

  return (
    <section className={cn(CARD, "flex flex-col gap-5 text-center")}>
      {step.at === "choose" && <Choose copy={copy} started={started} pending={pending} headingRef={heading} onMobile={sendNumber} onEmail={emailInstead} />}
      {step.at === "sms" && (
        <Sms
          // A new number starts the step afresh: empty boxes, no note.
          key={step.sentAt}
          copy={copy}
          attempt={started.attempt}
          step={step}
          headingRef={heading}
          pending={pending}
          onResend={sendNumber}
          onEmail={emailInstead}
          onRight={(phone) => setStep({ at: "password", phone })}
          onMobileUsed={() => setStep({ at: "mobile-used" })}
        />
      )}
      {step.at === "email" && (
        <>
          <h1 ref={heading} tabIndex={-1} className={TITLE}>
            {copy.emailTitle}
          </h1>
          <p className="text-[15px] text-slate-600">
            {copy.emailSentTo} <b className="wrap-anywhere text-slate-800">{step.email}</b>. {copy.spam}
          </p>
          <button type="button" className="font-semibold text-blue-700 underline underline-offset-2" onClick={onChangeEmail}>
            {copy.changeEmail}
          </button>
        </>
      )}
      {step.at === "mobile-used" && (
        <>
          <h1 ref={heading} tabIndex={-1} className={TITLE}>
            {copy.mobileUsedTitle}
          </h1>
          <NoticeBox role="alert" tone="info">
            {copy.mobileUsed}
          </NoticeBox>
          <ContinuePill type="button" pending={pending} disabled={pending} onClick={emailInstead}>
            {copy.useEmail}
          </ContinuePill>
        </>
      )}
      {step.at === "password" && <Password copy={copy} language={language} attempt={started.attempt} phone={step.phone} headingRef={heading} />}
      {problem && (
        <NoticeBox role="alert" tone="info">
          {problem}
        </NoticeBox>
      )}
    </section>
  )
}

type Copy = (typeof SELF_CONFIRM_COPY)[Language]

function Choose({
  copy,
  started,
  pending,
  headingRef,
  onMobile,
  onEmail,
}: {
  copy: Copy
  started: Started
  pending: boolean
  headingRef: React.RefObject<HTMLHeadingElement | null>
  onMobile: () => void
  onEmail: () => void
}) {
  const [choice, setChoice] = useState<string | null>(started.canText ? null : "email")
  const options = [
    ...(started.canText ? [{ value: "mobile", label: copy.byMobile, description: copy.byMobileHint }] : []),
    { value: "email", label: copy.byEmail, description: copy.byEmailHint },
  ]
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        {copy.chooseTitle}
      </h1>
      <ChoiceTiles name="sign_in_with" legend={<QuestionTitle>{copy.chooseTitle}</QuestionTitle>} layout="rows" options={options} value={choice} onChange={setChoice}>
        <p className="text-sm text-slate-600">{copy.chooseIntro}</p>
      </ChoiceTiles>
      <ContinuePill type="button" pending={pending} disabled={pending || !choice} onClick={() => (choice === "mobile" ? onMobile() : onEmail())}>
        {copy.continue}
      </ContinuePill>
    </>
  )
}

function Sms({
  copy,
  attempt,
  step,
  headingRef,
  pending,
  onResend,
  onEmail,
  onRight,
  onMobileUsed,
}: {
  copy: Copy
  attempt: string
  step: Extract<Step, { at: "sms" }>
  headingRef: React.RefObject<HTMLHeadingElement | null>
  pending: boolean
  onResend: () => void
  onEmail: () => void
  onRight: (phone: string) => void
  onMobileUsed: () => void
}) {
  const boxes = useRef<ConfirmationNumberHandle>(null)
  const answer = useRef<CheckStatus | null>(null)
  const [note, setNote] = useState<CheckStatus | null>(null)
  const [noSms, setNoSms] = useState(false)
  const left = useCountdown(step.sentAt)

  async function check(code: string): Promise<ConfirmationResult> {
    setNote(null)
    let checked: CheckStatus
    try {
      checked = await checkSelfConfirmNumber(attempt, code)
    } catch {
      checked = { status: "unavailable" }
    }
    answer.current = checked
    return checked.status === "right" ? "ok" : "bad"
  }
  function settled(result: ConfirmationResult) {
    const checked = answer.current
    if (result === "ok" && checked?.status === "right") return onRight(checked.phone)
    if (checked?.status === "mobile-used") return onMobileUsed()
    setNote(checked)
  }

  const noteText = (checked: CheckStatus) => {
    switch (checked.status) {
      case "wrong":
        return `${copy.wrong} ${copy.triesLeft} ${checked.triesLeft}`
      case "expired-number":
        return copy.expired
      case "locked":
        return copy.locked
      case "unavailable":
        return copy.unavailable
      default:
        return copy.expired
    }
  }

  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className={TITLE}>
        {copy.smsTitle}
      </h1>
      <p className="text-[15px] text-slate-600">
        {step.masked ? (
          <>
            {copy.smsSentTo} <span className="font-semibold text-slate-800 tabular-nums">{step.masked}</span>.
          </>
        ) : (
          copy.smsToRecord
        )}
      </p>
      {step.onRecord && !step.masked && (
        <NoticeBox role="note" tone="info">
          {copy.smsNotTyped}
        </NoticeBox>
      )}
      <ConfirmationNumber ref={boxes} label={copy.number} digitLabel={copy.digit} onComplete={check} onSettled={settled} disabled={pending} autoFocus />
      {note && (
        <NoticeBox role="alert" tone="info">
          {noteText(note)}
          {(note.status === "wrong" || note.status === "unavailable") && (
            <>
              <br />
              <button type="button" className="font-semibold text-blue-700 underline underline-offset-2" onClick={() => (setNote(null), boxes.current?.reset())}>
                {copy.tryAgain}
              </button>
            </>
          )}
          {note.status === "locked" && (
            <>
              <br />
              <button type="button" className="font-semibold text-blue-700 underline underline-offset-2" onClick={onEmail}>
                {copy.useEmail}
              </button>
            </>
          )}
        </NoticeBox>
      )}
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onResend}
          disabled={pending || left > 0}
          className="rounded-full px-4 py-2 text-[14px] font-semibold text-blue-600 underline-offset-2 enabled:hover:underline disabled:text-slate-400"
        >
          {left > 0 ? (
            <>
              {copy.sendAgainIn} <span className="tabular-nums">{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</span>
            </>
          ) : note?.status === "expired-number" ? (
            copy.sendNew
          ) : (
            copy.sendAgain
          )}
        </button>
        <button type="button" className="text-[14px] font-semibold text-blue-700 underline underline-offset-2" onClick={() => setNoSms((open) => !open)} aria-expanded={noSms}>
          {copy.noSms}
        </button>
        {noSms && (
          <div className="flex w-full flex-col gap-3 text-left">
            <p className="text-sm text-slate-600">{copy.noSmsHint}</p>
            <p className="text-sm text-slate-600">{copy.orEmail}</p>
            <ContinuePill type="button" pending={pending} disabled={pending} onClick={onEmail}>
              {copy.useEmail}
            </ContinuePill>
          </div>
        )}
      </div>
    </>
  )
}

function useCountdown(from: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return Math.min(RESEND_SECONDS, Math.max(0, Math.ceil((from + RESEND_SECONDS * 1000 - now) / 1000)))
}

function Password({
  copy,
  language,
  attempt,
  phone,
  headingRef,
}: {
  copy: Copy
  language: Language
  attempt: string
  phone: string
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const [state, formAction, pending] = useActionState(finishSelfConfirm, null)
  const turnstile = useRef<TurnstileWidgetHandle>(null)
  useEffect(() => {
    if (state) turnstile.current?.reset()
  }, [state])
  const message =
    state?.error === "password-mismatch"
      ? copy.passwordMismatch
      : state?.error === "password-too-short"
        ? copy.passwordTooShort
        : state?.error === "check-pending"
          ? copy.checkPending
          : state?.error === "expired"
            ? copy.expired
            : state
              ? copy.unavailable
              : null
  return (
    <form action={formAction} className="flex flex-col gap-3 text-left" noValidate>
      <h1 ref={headingRef} tabIndex={-1} className={cn(TITLE, "text-center")}>
        {copy.passwordTitle}
      </h1>
      <p className="text-center text-[15px] text-slate-600">{copy.passwordIntro}</p>
      <input type="hidden" name="attempt" value={attempt} />
      <input type="hidden" name="phone" value={phone} />
      <label htmlFor="self-confirm-password" className="sr-only">
        {copy.newPassword}
      </label>
      <FieldInput
        id="self-confirm-password"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder={copy.newPassword}
        minLength={MINIMUM_PASSWORD_LENGTH}
        required
        alignStart
        icon={<Lock className="size-5" strokeWidth={1.75} aria-hidden />}
        aria-describedby="self-confirm-rule"
      />
      <p id="self-confirm-rule" className="pl-4 text-[12px] text-slate-500">
        {copy.passwordRule}
      </p>
      <label htmlFor="self-confirm-confirm" className="sr-only">
        {copy.confirmPassword}
      </label>
      <FieldInput
        id="self-confirm-confirm"
        name="confirm"
        type="password"
        autoComplete="new-password"
        placeholder={copy.confirmPassword}
        minLength={MINIMUM_PASSWORD_LENGTH}
        required
        alignStart
        icon={<Lock className="size-5" strokeWidth={1.75} aria-hidden />}
      />
      {message && (
        <NoticeBox role="alert" tone="info">
          {message}
        </NoticeBox>
      )}
      <TurnstileWidget ref={turnstile} action="agent" language={language} className="mt-1" />
      <ContinuePill type="submit" pending={pending} disabled={pending}>
        {pending ? copy.saving : copy.setPassword}
      </ContinuePill>
    </form>
  )
}
