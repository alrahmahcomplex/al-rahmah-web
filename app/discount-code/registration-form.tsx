"use client"

import { Check, Copy, Phone } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState, useTransition } from "react"

import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import { buttonVariants } from "@/components/ui/button"
import { agentRegistrationProblem, type AgentDraft, type AgentField } from "@/lib/agent-registration"
import { discountCodeShareLink } from "@/lib/discount-code-share"
import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

import { registerAsAgent } from "./actions"
import { COPY } from "./copy"
import type { DiscountCodeMessage, DiscountCodeState } from "./outcome"

// The Discount code page's form and its confirmation. The entries live in this
// component's state, so switching language (which re-renders the page around
// it) or a refused send never loses one. The "Already have a Discount code?"
// box claims an existing code (#193); the code field is there either way,
// and the box makes it required.

const EMPTY: AgentDraft = { fullName: "", phone: "", whatsapp: "", email: "", hasCode: false, code: "" }

type Copy = (typeof COPY)[Language]
type Done = Extract<DiscountCodeState, { status: "registered" | "claimed" }>
// A problem shown under its field. `server` marks a phone or code the
// database couldn't read, which reads differently from an empty one.
type Shown = { field: AgentField; server: boolean }
type Notice = "check-pending" | DiscountCodeMessage | null

// Answers that aren't a problem with the form: shown calmly, in blue.
const CALM = new Set<Notice>(["claim-waiting", "invited", "joined"])

function noticeText(copy: Copy, notice: Exclude<Notice, null>): string {
  switch (notice) {
    case "check-pending":
      return copy.checkPending
    case "rate-limited":
      return copy.rateLimited
    case "check-failed":
      return copy.checkFailed
    case "unavailable":
      return copy.unavailable
    default:
      return copy.messages[notice]
  }
}

// `discount` is the interview discount in whole TZS, or null when the page
// couldn't read it.
export function DiscountCodeForm({
  language,
  officePhone,
  discount = null,
}: {
  language: Language
  officePhone: string
  discount?: number | null
}) {
  const copy = COPY[language]
  const [draft, setDraft] = useState<AgentDraft>(EMPTY)
  const [problem, setProblem] = useState<Shown | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [sending, startSending] = useTransition()
  const turnstile = useRef<TurnstileWidgetHandle>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  // After a send, put the reader at the field to fix, or at the confirmation.
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    const target = problem ? document.querySelector<HTMLElement>(`[data-field="${problem.field}"]`) : heading.current
    target?.focus()
  }, [problem, done])

  function update(change: Partial<AgentDraft>) {
    setDraft((current) => ({ ...current, ...change }))
    setProblem(null)
  }

  function show(shown: Shown) {
    moved.current = true
    setProblem(shown)
  }

  function onSend(form: HTMLFormElement) {
    if (sending) return
    const found = agentRegistrationProblem(draft)
    if (found) return show({ field: found, server: false })

    const data = new FormData(form)
    // Turnstile fills its token in a moment after the page opens; sending
    // before then would only be refused.
    if (!data.get("cf-turnstile-response")) {
      setNotice("check-pending")
      return
    }
    data.set("full_name", draft.fullName)
    data.set("phone", draft.phone)
    data.set("whatsapp", draft.whatsapp)
    data.set("email", draft.email)
    data.set("has_code", draft.hasCode ? "yes" : "no")
    data.set("code", draft.code)
    setNotice(null)
    setProblem(null)
    startSending(async () => {
      let result: DiscountCodeState
      try {
        result = await registerAsAgent({ status: "idle" }, data)
      } catch {
        result = { status: "unavailable" }
      }
      if (result.status === "registered" || result.status === "claimed") {
        moved.current = true
        setDone(result)
        return
      }
      // The token is spent once checked, so get a fresh one for the next try.
      turnstile.current?.reset()
      if (result.status === "invalid") return show({ field: result.field, server: true })
      setNotice(result.status === "idle" ? "unavailable" : result.status)
    })
  }

  if (done) {
    return <Confirmation copy={copy} done={done} officePhone={officePhone} headingRef={heading} />
  }

  const message = (field: AgentField) => {
    if (problem?.field !== field) return null
    if (problem.server && field === "phone") return copy.problems.phone_unreadable
    if (problem.server && field === "code") return copy.problems.code_unreadable
    return copy.problems[field]
  }

  return (
    <section className="rounded-[40px] bg-white px-5 py-7 shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px] sm:px-8">
      <h1 className="font-exo text-[1.75rem] font-extrabold italic leading-tight text-blue-600">{copy.heading}</h1>
      <p className="mt-3 text-base text-slate-700">{copy.intro(discount === null ? null : `TZS ${discount.toLocaleString("en-US")}`)}</p>

      <form
        noValidate
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault()
          onSend(event.currentTarget)
        }}
      >
        <div className="flex flex-col gap-5">
          <TextField
            id="full-name"
            field="full_name"
            label={copy.fullName}
            value={draft.fullName}
            onChange={(fullName) => update({ fullName })}
            autoComplete="name"
            error={message("full_name")}
          />
          <TextField
            id="phone"
            field="phone"
            label={copy.phone}
            hint={copy.phoneHint}
            value={draft.phone}
            onChange={(phone) => update({ phone })}
            type="tel"
            autoComplete="tel"
            error={message("phone")}
          />
          <TextField
            id="whatsapp"
            field="whatsapp"
            label={`${copy.whatsapp} (${copy.optional})`}
            hint={copy.whatsappHint}
            value={draft.whatsapp}
            onChange={(whatsapp) => update({ whatsapp })}
            type="tel"
            error={message("whatsapp")}
          />
          <TextField
            id="email"
            field="email"
            label={copy.email}
            hint={copy.emailHint}
            value={draft.email}
            onChange={(email) => update({ email })}
            type="email"
            autoComplete="email"
            error={message("email")}
          />
          <div className="rounded-3xl bg-blue-50 px-4 py-4 ring-1 ring-blue-100">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={draft.hasCode}
                onChange={(event) => update({ hasCode: event.target.checked })}
                aria-describedby="has-code-hint"
                className="mt-0.5 size-5 shrink-0 accent-blue-600"
              />
              <span className="text-sm font-semibold text-slate-800">{copy.hasCode}</span>
            </label>
            <p id="has-code-hint" className="mt-1 pl-8 text-sm text-slate-600">
              {copy.hasCodeHint}
            </p>
            <div className="mt-4">
              <TextField
                id="code"
                field="code"
                label={draft.hasCode ? copy.code : `${copy.code} (${copy.optional})`}
                hint={copy.codeHint}
                value={draft.code}
                onChange={(code) => update({ code })}
                autoComplete="off"
                error={message("code")}
              />
            </div>
          </div>
          <div>
            <TurnstileWidget ref={turnstile} action="agent" language={language} />
            <p className="mt-1 text-center text-xs text-slate-500">{copy.securityNote}</p>
          </div>
        </div>

        {notice && (
          <div
            role="alert"
            className={cn(
              "mt-5 rounded-2xl px-4 py-3 text-sm ring-1",
              CALM.has(notice) ? "bg-blue-50 text-blue-950 ring-blue-200" : "bg-red-50 text-red-700 ring-red-200",
            )}
          >
            <p>{noticeText(copy, notice)}</p>
            {notice === "joined" && (
              <Link href="/discount-code/sign-in" className="mt-1 inline-block font-semibold underline underline-offset-4">
                {copy.signIn}
              </Link>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={sending}
          className={cn(
            buttonVariants({ variant: "orange" }),
            "mt-7 h-12 w-full rounded-full font-exo text-lg italic shadow-md shadow-orange-500/20 transition hover:-translate-y-0.5 active:scale-95 disabled:translate-y-0 disabled:opacity-70",
          )}
        >
          {sending ? copy.sending : copy.send}
        </button>
      </form>

      {/* Kept apart from the box above: this one is for someone who has
          already set a password. */}
      <p className="mt-6 text-center text-sm text-slate-600">
        {copy.signInPrompt}{" "}
        <Link
          href="/discount-code/sign-in"
          className="font-semibold text-blue-600 underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40"
        >
          {copy.signIn}
        </Link>
      </p>
    </section>
  )
}

function TextField({
  id,
  field,
  label,
  hint,
  value,
  onChange,
  type = "text",
  autoComplete,
  error,
}: {
  id: string
  field: AgentField
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "tel" | "email"
  autoComplete?: string
  error: string | null
}) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-slate-500">
          {hint}
        </p>
      )}
      <input
        id={id}
        name={field}
        data-field={field}
        type={type}
        inputMode={type === "tel" ? "tel" : type === "email" ? "email" : undefined}
        autoComplete={autoComplete}
        value={value}
        maxLength={type === "email" ? 254 : 200}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className={cn(
          "mt-1.5 h-12 w-full rounded-full border bg-white px-5 text-base text-slate-800 outline-none transition focus-visible:border-blue-600 focus-visible:ring-3 focus-visible:ring-blue-600/20",
          error ? "border-red-500" : "border-blue-600/30",
        )}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

function Confirmation({
  copy,
  done,
  officePhone,
  headingRef,
}: {
  copy: Copy
  done: Done
  officePhone: string
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null)
  const shareHref = discountCodeShareLink(copy.shareText(done.code, done.link))

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(done.link)
      setCopied("yes")
    } catch {
      setCopied("failed")
    }
  }

  return (
    <section className="rounded-[40px] bg-white px-5 py-8 text-center shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px] sm:px-8">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-orange-500 text-white">
        <Check className="size-8" strokeWidth={3} aria-hidden />
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-4 font-exo text-[1.75rem] font-extrabold italic leading-tight text-blue-600 outline-none">
        {copy.doneTitle}
      </h1>
      <p className="mt-4 rounded-3xl bg-blue-50 px-4 py-5 font-mono text-[2.5rem] font-bold leading-tight tracking-wide text-blue-600 ring-1 ring-blue-100">
        {done.code}
      </p>

      <div className="mt-6 text-left">
        <p className="text-sm font-semibold text-slate-700">{copy.linkLabel}</p>
        <p className="mt-1.5 break-all rounded-2xl bg-slate-50 px-4 py-3 font-mono text-sm text-slate-800 ring-1 ring-slate-200 select-all">
          {done.link}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-blue-600/30 px-6 font-exo text-base font-bold italic text-blue-600 outline-none transition hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
          >
            {copied === "yes" ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
            {copied === "yes" ? copy.copied : copy.copy}
          </button>
          {shareHref && (
            <a
              href={shareHref}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ variant: "orange" }),
                "h-12 rounded-full px-6 font-exo text-lg italic shadow-md shadow-orange-500/20",
              )}
            >
              {copy.share}
            </a>
          )}
        </div>
        <p aria-live="polite" className={cn("mt-2 text-sm text-red-600", copied !== "failed" && "sr-only")}>
          {copied === "failed" ? copy.copyFailed : copied === "yes" ? copy.copied : ""}
        </p>
      </div>

      {done.status === "registered" ? (
        <>
          <p className="mt-6 rounded-3xl bg-orange-50 px-4 py-3 text-base text-orange-950">{copy.confirmNote}</p>
          <p className="mt-3 rounded-3xl bg-blue-50 px-4 py-3 text-base wrap-anywhere text-blue-950">{copy.emailNote(done.email)}</p>
        </>
      ) : (
        <p className="mt-6 rounded-3xl bg-blue-50 px-4 py-3 text-base text-blue-950">{copy.claimNote}</p>
      )}

      <p className="mt-6 text-sm text-slate-600">{copy.call}</p>
      <a
        href={`tel:${officePhone.replaceAll(" ", "")}`}
        className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-exo text-lg font-bold italic text-blue-600 outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
      >
        <Phone className="size-5" strokeWidth={2} aria-hidden />
        {officePhone}
      </a>
    </section>
  )
}
