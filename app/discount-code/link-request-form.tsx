"use client"

import { Mail, Phone } from "lucide-react"
import Link from "next/link"
import { useRef, useState, useTransition, type FormEvent } from "react"

import { AUTH_SUBMIT, IconField } from "@/components/auth-fields"
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget"
import type { Language } from "@/lib/language"

import { AccountMessageView } from "./account-message"
import { requestPasswordLink } from "./link-request-actions"
import { LINK_REQUEST_COPY, type LinkRequestStatus } from "./link-request-copy"

// Asks for a new password link by email (#194): "Umesahau nenosiri?" and
// the expired-link panel's "Tuma kiungo kipya". `form` names the firewall key.
export function LinkRequestForm({ language, form }: { language: Language; form: "agent-reset" | "agent-new-link" }) {
  const copy = LINK_REQUEST_COPY[language]
  const [status, setStatus] = useState<LinkRequestStatus | null>(null)
  const [pending, startSending] = useTransition()
  const turnstile = useRef<TurnstileWidgetHandle>(null)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    // Turnstile fills its token in a moment after the page opens.
    if (!data.get("cf-turnstile-response")) {
      // A check that needs a click says so itself, next to Send.
      setStatus(turnstile.current?.reveal() ? null : "check-pending")
      return
    }
    setStatus(null)
    startSending(async () => {
      let result: LinkRequestStatus
      try {
        result = (await requestPasswordLink(data)).status
      } catch {
        result = "unavailable"
      }
      // The token is spent once checked, so get a fresh one for the next try.
      if (result !== "sent") turnstile.current?.reset()
      setStatus(result)
    })
  }

  if (status === "sent") {
    return (
      <p role="status" className="text-center font-exo text-[14px] text-slate-700">
        {copy.sent}
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="form" value={form} />
      <IconField id={`${form}-email`} name="email" label={copy.email} icon={Mail} type="email" autoComplete="email" required />

      {status && <AccountMessageView language={language} message={copy.messages[status]} />}

      {/* Invisible unless Cloudflare needs a click, and then right above Send. */}
      <TurnstileWidget ref={turnstile} action="agent-link" language={language} />

      <button type="submit" disabled={pending} className={AUTH_SUBMIT}>
        {pending ? copy.sending : copy.send}
      </button>
    </form>
  )
}

export function SignInLink({ language }: { language: Language }) {
  return (
    <Link href="/login" className="text-center font-exo text-[13px] text-blue-600 underline underline-offset-2">
      {LINK_REQUEST_COPY[language].goToSignIn}
    </Link>
  )
}

// "Piga simu ofisini", the fallback under every link request.
export function CallOffice({ language, officePhone }: { language: Language; officePhone: string }) {
  const copy = LINK_REQUEST_COPY[language]
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="font-exo text-[13px] text-slate-500">{copy.fallback}</p>
      <a
        href={`tel:${officePhone.replace(/\s/g, "")}`}
        className="inline-flex items-center gap-2 font-exo text-[14px] font-bold italic text-blue-600 underline underline-offset-2"
      >
        <Phone className="h-4 w-4" strokeWidth={1.5} />
        {copy.callOffice}: {officePhone}
      </a>
    </div>
  )
}

// What an expired or used invite or reset link shows: "Tuma kiungo kipya"
// first, which also works for someone invited who hasn't joined, then the
// office.
export function ExpiredLink({ language, officePhone }: { language: Language; officePhone: string }) {
  const copy = LINK_REQUEST_COPY[language]
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">{copy.expiredHeading}</h1>
        <p className="font-exo text-[13px] text-slate-600">{copy.expiredIntro}</p>
      </div>
      <LinkRequestForm language={language} form="agent-new-link" />
      <CallOffice language={language} officePhone={officePhone} />
      <SignInLink language={language} />
    </div>
  )
}
