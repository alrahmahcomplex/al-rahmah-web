"use client"

import { Check, Copy, Phone } from "lucide-react"
import { useEffect, useRef, useState, useTransition } from "react"

import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import { agentRegistrationProblem, whatsappShareLink, type AgentDraft, type AgentField } from "@/lib/agent-registration"
import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

import { registerAsAgent } from "./actions"
import { COPY } from "./copy"
import type { DiscountCodeState } from "./outcome"

// The Discount code page's form and its confirmation. The entries live in this
// component's state, so switching language (which re-renders the page around
// it) or a refused send never loses one.

const EMPTY: AgentDraft = { fullName: "", phone: "", whatsapp: "" }

type Copy = (typeof COPY)[Language]
type Registered = Extract<DiscountCodeState, { status: "registered" }>
// A problem shown under its field. `server` marks a phone the database
// couldn't read, which reads differently from an empty one.
type Shown = { field: AgentField; server: boolean }
type Notice = "check-pending" | "rate-limited" | "check-failed" | "unavailable" | null

export function DiscountCodeForm({ language, officePhone }: { language: Language; officePhone: string }) {
  const copy = COPY[language]
  const [draft, setDraft] = useState<AgentDraft>(EMPTY)
  const [problem, setProblem] = useState<Shown | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [registered, setRegistered] = useState<Registered | null>(null)
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
  }, [problem, registered])

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
    setNotice(null)
    setProblem(null)
    startSending(async () => {
      let result: DiscountCodeState
      try {
        result = await registerAsAgent({ status: "idle" }, data)
      } catch {
        result = { status: "unavailable" }
      }
      if (result.status === "registered") {
        moved.current = true
        setRegistered(result)
        return
      }
      // The token is spent once checked, so get a fresh one for the next try.
      turnstile.current?.reset()
      if (result.status === "invalid") return show({ field: result.field, server: true })
      setNotice(result.status === "idle" ? "unavailable" : result.status)
    })
  }

  if (registered) {
    return <Confirmation copy={copy} registered={registered} officePhone={officePhone} headingRef={heading} />
  }

  const message = (field: AgentField) => {
    if (problem?.field !== field) return null
    if (problem.server && field === "phone") return copy.problems.phone_unreadable
    return copy.problems[field]
  }
  const noticeText = notice
    ? { "check-pending": copy.checkPending, "rate-limited": copy.rateLimited, "check-failed": copy.checkFailed, unavailable: copy.unavailable }[
        notice
      ]
    : null

  return (
    <section className="rounded-[40px] bg-white px-5 py-7 shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px] sm:px-8">
      <h1 className="font-exo text-[1.75rem] font-extrabold italic leading-tight text-blue-600">{copy.heading}</h1>
      <p className="mt-3 text-base text-slate-700">{copy.intro}</p>

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
          <div>
            <TurnstileWidget ref={turnstile} action="agent" language={language} />
            <p className="mt-1 text-center text-xs text-slate-500">{copy.securityNote}</p>
          </div>
        </div>

        {noticeText && (
          <p role="alert" className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {noticeText}
          </p>
        )}

        <button
          type="submit"
          disabled={sending}
          className="mt-7 h-12 w-full rounded-full bg-orange-500 font-exo text-lg font-bold italic text-blue-600 shadow-md shadow-orange-500/20 outline-none transition hover:-translate-y-0.5 hover:bg-orange-600 hover:text-blue-900 focus-visible:ring-3 focus-visible:ring-blue-600/40 active:scale-95 disabled:translate-y-0 disabled:opacity-70"
        >
          {sending ? copy.sending : copy.send}
        </button>
      </form>
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
  type?: "text" | "tel"
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
        inputMode={type === "tel" ? "tel" : undefined}
        autoComplete={autoComplete}
        value={value}
        maxLength={200}
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
  registered,
  officePhone,
  headingRef,
}: {
  copy: Copy
  registered: Registered
  officePhone: string
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(registered.link)
      setCopied("yes")
    } catch {
      setCopied("failed")
    }
  }

  return (
    <section className="rounded-[40px] bg-white px-5 py-8 text-center shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px] sm:px-8">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-orange-500 text-blue-600">
        <Check className="size-8" strokeWidth={3} aria-hidden />
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-4 font-exo text-[1.75rem] font-extrabold italic leading-tight text-blue-600 outline-none">
        {copy.doneTitle}
      </h1>
      <p className="mt-4 rounded-3xl bg-blue-50 px-4 py-5 font-mono text-[2.5rem] font-bold leading-tight tracking-wide text-blue-600 ring-1 ring-blue-100">
        {registered.code}
      </p>

      <div className="mt-6 text-left">
        <p className="text-sm font-semibold text-slate-700">{copy.linkLabel}</p>
        <p className="mt-1.5 break-all rounded-2xl bg-slate-50 px-4 py-3 font-mono text-sm text-slate-800 ring-1 ring-slate-200 select-all">
          {registered.link}
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
          <a
            href={whatsappShareLink(copy.shareText(registered.code, registered.link))}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center justify-center rounded-full bg-orange-500 px-6 font-exo text-lg font-bold italic text-blue-600 shadow-md shadow-orange-500/20 outline-none transition hover:bg-orange-600 hover:text-blue-900 focus-visible:ring-3 focus-visible:ring-blue-600/40"
          >
            {copy.share}
          </a>
        </div>
        <p aria-live="polite" className={cn("mt-2 text-sm text-red-600", copied !== "failed" && "sr-only")}>
          {copied === "failed" ? copy.copyFailed : copied === "yes" ? copy.copied : ""}
        </p>
      </div>

      <p className="mt-6 rounded-3xl bg-orange-50 px-4 py-3 text-base text-orange-950">{copy.confirmNote}</p>

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
