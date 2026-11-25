"use client"

import { Lock } from "lucide-react"
import { useActionState, useEffect, useRef, useState, useTransition } from "react"

import {
  CallOffice,
  ChoiceTiles,
  ConfirmationNumber,
  ContinuePill,
  FieldInput,
  NoticeBox,
  QuestionTitle,
  StepIcon,
  type ConfirmationNumberHandle,
  type ConfirmationResult,
} from "@/components/guided-form"
import type { Language } from "@/lib/language"
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"
import { cn } from "@/lib/utils"

import { ACCOUNT_COPY } from "./account-copy"
import { COPY } from "./copy"
import { clearFlow, writeFlow, type SavedStep } from "./flow-state"
import { CARD } from "./frame"
import type { DiscountCodeState } from "./outcome"
import { QuietCheck, useQuietCheck } from "./quiet-check"
import { SELF_CONFIRM_COPY } from "./self-confirm-copy"
import {
  checkSelfConfirmNumber,
  finishSelfConfirm,
  sendSelfConfirmEmail,
  sendSelfConfirmNumber,
  setNewAgentEmailAction,
  type CheckStatus,
  type NumberStatus,
} from "./self-confirm-actions"

// Self-confirm (#503 slice 3, prototype v58 states 2 to 5 and E1 to E8),
// after the code and names have matched: the agent chooses how to sign in.
// By mobile, a confirmation number to the mobile on record (or the typed
// one when none is on file), then a password; by email, today's invite.
//
// Each step looks as the approved prototype draws it (owner, prototype v5,
// 25 Nov 2026): its icon in a disc on top, the title, and the office's number
// at the foot. No progress bar: the answers are already sent, so there is
// nothing to go back to. The step is kept in the tab (./flow-state.ts), so a
// reload on Choose, Check your SMS or Set password comes back to it.

type Started = Extract<DiscountCodeState, { status: "self-confirm" }>
type Step = SavedStep | { at: "email"; email: string } | { at: "mobile-used" }
type Registered = Extract<DiscountCodeState, { status: "registered" }>

const RESEND_SECONDS = 60
const TITLE = "font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic outline-none"

// "+255712345123" as the person types it: 0712345123.
const localMobile = (phone: string) => (phone.startsWith("+255") ? `0${phone.slice(4)}` : phone)

// `onFinished` runs once the email is on its way or the password form is sent:
// the form's draft is no longer needed (#503 slice 4d). Without
// `onChangeEmail` the email is asked here, on the email path, when there is
// none yet (self-confirm's order, #503 slice 4d-b). `onRegistered`: a new
// agent's email went on their waiting code; the form shows today's finish.
// `startedAt`, `initialStep` and `initialSmsOff` bring a reloaded flow back.
export function SelfConfirmFlow({
  language,
  officePhone,
  started,
  startedAt,
  initialStep,
  initialSmsOff = false,
  onChangeEmail,
  onFinished,
  onRegistered,
}: {
  language: Language
  officePhone: string
  started: Started
  startedAt: number
  initialStep?: SavedStep
  initialSmsOff?: boolean
  onChangeEmail?: () => void
  onFinished?: () => void
  onRegistered?: (registered: Registered) => void
}) {
  const copy = SELF_CONFIRM_COPY[language]
  const [step, setStep] = useState<Step>(initialStep ?? { at: "choose" })
  const [problem, setProblem] = useState<string | null>(null)
  // No SMS could go to the mobile: the choice offers email only.
  const [smsOff, setSmsOff] = useState(initialSmsOff)
  const [pending, startWork] = useTransition()
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => heading.current?.focus({ preventScroll: true }), [step.at])

  // Keeps the step in the tab for a reload; a step that ends the flow here
  // (the email on its way, or the mobile in use elsewhere) clears it.
  useEffect(() => {
    if (step.at === "email" || step.at === "mobile-used") clearFlow()
    else writeFlow({ started, startedAt, step, smsOff })
  }, [started, startedAt, step, smsOff])

  const keepStep = () => {
    if (step.at !== "email" && step.at !== "mobile-used") writeFlow({ started, startedAt, step, smsOff })
  }

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
      if (sent.status === "sent") return setStep({ at: "sms", masked: sent.masked, onRecord: sent.onRecord, sentAt: Date.now() })
      if (sent.status === "no-sms") {
        // No SMS can go to this mobile now: the choice again, with email only.
        // With email closed on the code too, the mobile stays, to try later.
        if (!started.emailOpen) return setProblem(copy.unavailable)
        setSmsOff(true)
        setStep({ at: "choose" })
        setProblem(copy.unavailable)
        return
      }
      setProblem(numberProblem(sent.status))
    })
  }

  // The email typed on the form, or here.
  const [email, setEmail] = useState(started.email)

  function emailInstead() {
    setProblem(null)
    // Nothing on record and nothing typed yet: ask for it first.
    if (!started.emailOnRecord && !email.trim()) return setStep({ at: "ask-email" })
    sendEmail(email)
  }

  function sendEmail(address: string) {
    setProblem(null)
    startWork(async () => {
      if (started.newAgent) {
        let set
        try {
          set = await setNewAgentEmailAction(started.attempt, address)
        } catch {
          set = { status: "unavailable" as const }
        }
        if (set.status === "registered") {
          clearFlow()
          onFinished?.()
          onRegistered?.(set)
          return
        }
        setProblem(set.status === "email-unusable" ? copy.emailUnusable : set.status === "no-email" ? COPY[language].problems.email : set.status === "expired" ? copy.expired : copy.unavailable)
        return
      }
      try {
        const sent = await sendSelfConfirmEmail(started.attempt, address)
        if (sent.status === "sent") {
          onFinished?.()
          return setStep({ at: "email", email: sent.email })
        }
        setProblem(sent.status === "email-unusable" ? copy.emailUnusable : sent.status === "no-email" ? copy.noEmail : sent.status === "limited" ? copy.limited : copy.unavailable)
      } catch {
        setProblem(copy.unavailable)
      }
    })
  }

  const call = <CallOffice label={COPY[language].call} phone={officePhone} className="mt-1" />

  return (
    <section className={cn(CARD, "flex flex-col gap-5 text-center")}>
      {step.at === "choose" && (
        <>
          <StepIcon name="lock" />
          <Choose key={String(smsOff)} copy={copy} started={smsOff ? { ...started, canText: false } : started} pending={pending} headingRef={heading} onMobile={sendNumber} onEmail={emailInstead} />
        </>
      )}
      {step.at === "sms" && (
        <>
          <StepIcon name="smscode" />
          <Sms
            // A new number starts the step afresh: empty boxes, no note.
            key={step.sentAt}
            copy={copy}
            attempt={started.attempt}
            step={step}
            headingRef={heading}
            pending={pending}
            onResend={sendNumber}
            // Email is closed on the code after Remove this sign-in with its tick.
            onEmail={started.emailOpen ? emailInstead : null}
            onRight={(phone) => setStep({ at: "password", phone })}
            onMobileUsed={() => setStep({ at: "mobile-used" })}
          />
        </>
      )}
      {step.at === "ask-email" && (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            sendEmail(email)
          }}
        >
          <StepIcon name="mail" />
          <h1 ref={heading} tabIndex={-1} className="sr-only">
            {COPY[language].emailQuestion}
          </h1>
          <QuestionTitle htmlFor="self-confirm-email">{COPY[language].emailQuestion}</QuestionTitle>
          <p id="self-confirm-email-hint" className="-mt-2 text-sm text-slate-600">
            {COPY[language].emailHint}
          </p>
          <FieldInput
            id="self-confirm-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby="self-confirm-email-hint"
          />
          <ContinuePill type="submit" pending={pending} disabled={pending}>
            {copy.continue}
          </ContinuePill>
        </form>
      )}
      {step.at === "email" && (
        <>
          <StepIcon name="mail" />
          <h1 ref={heading} tabIndex={-1} className={TITLE}>
            {copy.emailTitle}
          </h1>
          <p className="-mt-2 text-[15px] text-slate-600">
            {copy.emailSentTo} <b className="wrap-anywhere text-slate-800">{step.email}</b>. {copy.spam}
          </p>
          {!started.emailOnRecord && (
            <button type="button" className="font-semibold text-blue-700 underline underline-offset-2" onClick={onChangeEmail ?? (() => setStep({ at: "ask-email" }))}>
              {copy.changeEmail}
            </button>
          )}
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
          {started.emailOpen && (
            <ContinuePill type="button" pending={pending} disabled={pending} onClick={emailInstead}>
              {copy.useEmail}
            </ContinuePill>
          )}
        </>
      )}
      {step.at === "password" && (
        <>
          <StepIcon name="lock" />
          <Password
            copy={copy}
            language={language}
            attempt={started.attempt}
            phone={step.phone}
            headingRef={heading}
            // Sent: a finished flow must not come back on a reload. A refusal puts it back.
            onSubmit={() => {
              clearFlow()
              onFinished?.()
            }}
            onRefused={keepStep}
          />
        </>
      )}
      {problem && (
        <NoticeBox role="alert" tone="info">
          {problem}
        </NoticeBox>
      )}
      {call}
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
  // Email is closed on the code after Remove this sign-in with its tick.
  const [choice, setChoice] = useState<string | null>(started.canText && started.emailOpen ? null : started.canText ? "mobile" : started.emailOpen ? "email" : null)
  const options = [
    ...(started.canText ? [{ value: "mobile", label: copy.byMobile, description: copy.byMobileHint }] : []),
    ...(started.emailOpen ? [{ value: "email", label: copy.byEmail, description: copy.byEmailHint }] : []),
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
  onEmail: (() => void) | null
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
      <p className="-mt-2 text-[15px] text-slate-600">
        {step.masked ? (
          <>
            {copy.smsSentTo} <b className="font-semibold text-slate-800 tabular-nums">{step.masked}</b>.
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
          {note.status === "locked" && onEmail && (
            <>
              <br />
              <button type="button" className="font-semibold text-blue-700 underline underline-offset-2" onClick={onEmail}>
                {copy.useEmail}
              </button>
            </>
          )}
        </NoticeBox>
      )}
      <div className="flex flex-col items-center gap-3">
        {/* Outlined across the card, with its countdown (the approved prototype v58). */}
        <ContinuePill variant="ghost" onClick={onResend} disabled={pending || left > 0} pending={pending} className="disabled:opacity-60" data-send-again>
          {left > 0 ? (
            <>
              {copy.sendAgainIn} <span className="tabular-nums">{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</span>
            </>
          ) : note?.status === "expired-number" ? (
            copy.sendNew
          ) : (
            copy.sendAgain
          )}
        </ContinuePill>
        <button type="button" className="text-[14px] font-semibold text-blue-700 underline underline-offset-2" onClick={() => setNoSms((open) => !open)} aria-expanded={noSms}>
          {copy.noSms}
        </button>
        {noSms && (
          <div className="flex w-full flex-col gap-3 text-left">
            <p className="text-sm text-slate-600">{copy.noSmsHint}</p>
            {onEmail && (
              <>
                <p className="text-sm text-slate-600">{copy.orEmail}</p>
                <ContinuePill type="button" pending={pending} disabled={pending} onClick={onEmail}>
                  {copy.useEmail}
                </ContinuePill>
              </>
            )}
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
  onSubmit,
  onRefused,
}: {
  copy: Copy
  language: Language
  attempt: string
  phone: string
  headingRef: React.RefObject<HTMLHeadingElement | null>
  onSubmit?: () => void
  onRefused?: () => void
}) {
  const [state, formAction, pending] = useActionState(finishSelfConfirm, null)
  const form = useRef<HTMLFormElement>(null)
  // The security check, out of sight unless it is slow or fails (prototype v5).
  const check = useQuietCheck()
  const { reset } = check
  const refused = useRef(onRefused)
  useEffect(() => {
    refused.current = onRefused
  })
  useEffect(() => {
    if (!state) return
    // A refused password form: the token is spent, and the step stays for a reload.
    reset()
    refused.current?.()
  }, [state, reset])
  const waiting = pending || check.waiting
  const message =
    state?.error === "password-mismatch"
      ? copy.passwordMismatch
      : state?.error === "password-too-short"
        ? copy.passwordTooShort
        : state?.error === "check-pending"
          ? copy.checkPending
          : state?.error === "staff-session"
            ? ACCOUNT_COPY[language].messages["staff-session"].text
            : state?.error === "expired"
              ? copy.expired
              : state
                ? copy.unavailable
                : null
  return (
    <form
      ref={form}
      action={formAction}
      onSubmit={(event) => {
        // Sent before the check has passed: the button waits, and the form
        // sends by itself once it does, with the passwords as typed.
        if (!new FormData(event.currentTarget).get("cf-turnstile-response") && !check.token()) {
          event.preventDefault()
          check.begin(() => form.current?.requestSubmit())
          return
        }
        onSubmit?.()
      }}
      className="flex flex-col gap-3 text-left"
      noValidate
    >
      <h1 ref={headingRef} tabIndex={-1} className={cn(TITLE, "text-center")}>
        {copy.passwordTitle}
      </h1>
      <p className="text-center text-[15px] text-slate-600">{copy.passwordIntro}</p>
      <p className="text-center text-[15px] text-slate-600">
        {copy.signsInWith} <b className="font-semibold text-slate-800 tabular-nums">{localMobile(phone)}</b>
      </p>
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
        aria-describedby="self-confirm-rule"
      />
      {/* The rule under both boxes, as the approved prototype draws it. */}
      <p id="self-confirm-rule" className="text-center text-[13px] text-slate-500">
        {copy.passwordRule}
      </p>
      {message && (
        <NoticeBox role="alert" tone="info">
          {message}
        </NoticeBox>
      )}
      <QuietCheck check={check} language={language} className="mt-1" />
      <ContinuePill type="submit" pending={waiting} disabled={waiting}>
        {waiting ? copy.saving : copy.setPassword}
      </ContinuePill>
    </form>
  )
}
