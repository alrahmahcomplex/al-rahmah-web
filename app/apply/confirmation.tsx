"use client"

import { Copy, MessageCircle, Phone } from "lucide-react"
import { useEffect, useRef, useState, type RefObject } from "react"

import { ChangeLink, Confetti, LiveCountPill, OfferNote } from "@/components/guided-form"
import { formatCount } from "@/lib/live-apply"

import type { FormCopy } from "./copy"
import { tzs } from "./questions"
import "./apply.css"

// The screen after a send: the success tick and confetti, each student's
// Admission Number with a copy button, the limited-time offer when a code
// brought the fee down, the office phone and "Fill in another form".

type Outcome = { fullName: string; admissionNumber: string }

export function Confirmation({
  copy,
  outcomes,
  alreadySent,
  officePhone,
  headingRef,
  savedTotal,
  applications,
  onAgain,
}: {
  copy: FormCopy
  outcomes: Outcome[]
  alreadySent: "all" | "some" | null
  officePhone: string
  headingRef: RefObject<HTMLHeadingElement | null>
  // What the family saves across the form, or 0 with no discount: the offer
  // card shows only with one.
  savedTotal: number
  // The application count to state, already passed through
  // shownApplicationCount: null leaves its sentence out.
  applications: number | null
  onAgain: () => void
}) {
  const mark = useRef<HTMLSpanElement>(null)
  const offer = copy.doneOffer(outcomes.length)
  const lines = outcomes.map((child) => `${child.fullName}: ${child.admissionNumber}`).join("\n")

  return (
    <div className="flex flex-col items-center gap-3.5 py-2 text-center">
      <span ref={mark} className="block">
        <svg className="apply-done-mark size-[84px]" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r="40" />
          <path d="M26 43l11 11 21-23" />
        </svg>
      </span>
      <Confetti originRef={mark} />
      <h2 ref={headingRef} tabIndex={-1} className="m-0 font-exo text-[26px] leading-[1.18] font-extrabold text-balance text-blue-600 italic outline-none">
        {copy.doneTitle}
      </h2>
      <p className="m-0 text-[15px] text-slate-600">{outcomes.length > 1 ? copy.keepNumbers : copy.keepNumber}</p>

      <ul className="m-0 flex w-full list-none flex-col gap-2.5 p-0">
        {outcomes.map((child, index) => (
          <li key={child.admissionNumber} className="apply-number flex items-center gap-3 rounded-[20px] bg-blue-50 py-3.5 pr-3.5 pl-[18px] text-left" style={{ animationDelay: `${520 + index * 90}ms` }}>
            <div className="min-w-0">
              <p className="m-0 text-sm text-slate-600 [overflow-wrap:anywhere]">
                <span>{child.fullName}</span> · <span>{copy.admissionNumber}</span>
              </p>
              <p className="m-0 font-exo text-2xl font-extrabold tracking-[0.02em] break-all text-blue-600 italic tabular-nums">{child.admissionNumber}</p>
            </div>
            <CopyButton copy={copy} text={child.admissionNumber} />
          </li>
        ))}
      </ul>

      {alreadySent && (
        <p className="m-0 w-full rounded-[20px] bg-orange-50 px-4 py-3 text-left text-[15px] text-orange-950">
          {alreadySent === "all" ? copy.alreadySent : copy.alreadySentInPart}
        </p>
      )}

      <a
        href={`https://wa.me/?text=${encodeURIComponent(copy.whatsappText(lines))}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-[24px] border-[1.5px] border-blue-600/45 px-6 font-exo text-lg font-semibold text-blue-600 italic no-underline outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40 active:scale-[0.96]"
      >
        <MessageCircle className="size-5" aria-hidden />
        {copy.whatsappSelf}
      </a>

      {savedTotal > 0 && (
        <OfferNote centred title={copy.doneOfferTitle(tzs(savedTotal))}>
          {offer.lead} {applications !== null && <>{offer.count}</>}
          {applications !== null && <LiveCountPill bumpKey={applications}>{formatCount(applications)}</LiveCountPill>}
          {offer.after}
        </OfferNote>
      )}

      <div className="flex flex-col items-center">
        <p className="m-0 text-sm text-slate-600">{copy.call}</p>
        <a
          href={`tel:${officePhone.replaceAll(" ", "")}`}
          className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-exo text-lg font-bold text-blue-600 italic outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
        >
          <Phone className="size-5" strokeWidth={2} aria-hidden />
          {officePhone}
        </a>
      </div>

      <ChangeLink onClick={onAgain}>{copy.again}</ChangeLink>
    </div>
  )
}

function CopyButton({ copy, text }: { copy: FormCopy; text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <ChangeLink
      className="ml-auto"
      aria-label={`${copy.copy} ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
        } catch {
          // No clipboard (an old in-app browser): the number stays on screen to write down.
        }
      }}
    >
      <Copy className="size-4" aria-hidden />
      <span aria-live="polite">{copied ? copy.copied : copy.copy}</span>
    </ChangeLink>
  )
}
