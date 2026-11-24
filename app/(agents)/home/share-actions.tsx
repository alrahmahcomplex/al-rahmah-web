"use client"

import { useEffect, useRef, useState } from "react"
import { useFormStatus } from "react-dom"

import { continueToStudents, spendWelcome } from "@/app/discount-code/students/actions"
import { Icon } from "@/components/icons"
import { Button, ChipButtons, FinishMark, Note, rainConfetti, toast } from "@/components/kit"
import type { Language } from "@/lib/language"

import { DISCOUNT_COPY, STUDENTS_COPY, whatsAppHref } from "../copy"

export type MessageKind = "parent" | "group" | "short"

/**
 * Ready-made share message picker inside the /home Share card (#539,
 * prototype v5): every button here is outlined (`ghost`) because the full-width
 * WhatsApp CTA at the top of /home is the page's one orange button.
 */
export function HomeMessagePicker({
  language,
  link,
  messages,
}: {
  language: Language
  link: string
  messages: Record<MessageKind, string>
}) {
  const copy = STUDENTS_COPY[language]
  const share = DISCOUNT_COPY[language]
  const [kind, setKind] = useState<MessageKind>("parent")
  const text = messages[kind]

  async function copyValue(value: string, okMessage: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast(okMessage, { tone: "good" })
    } catch {
      toast(share.copyFailed, { tone: "bad" })
    }
  }

  return (
    <div className="ag-picker">
      <ChipButtons
        label={copy.pickMessage}
        options={(["parent", "group", "short"] as const).map((value) => ({ value, label: copy.messages[value] }))}
        value={kind}
        onChange={(next) => setKind(next as MessageKind)}
      />
      <p className="ag-msg" aria-live="polite">
        {text}
      </p>
      <a href={whatsAppHref(text)} target="_blank" rel="noopener noreferrer" className="kit-btn kit-ghost kit-wide">
        <Icon name="chat" />
        <span>{share.share}</span>
      </a>
      <Button variant="ghost" size="wide" icon="copy" onClick={() => copyValue(text, copy.messageCopied)}>
        {copy.copyMessage}
      </Button>
      <Button variant="ghost" size="wide" icon="copy" onClick={() => copyValue(link, share.copied)}>
        {share.copy}
      </Button>
    </div>
  )
}

/**
 * Waiting code screen (/home while code is Pending, #503 / #539): big dashed
 * code, referral link, orange Share on WhatsApp first, outlined Copy link
 * second, confirmation & mobile wait notes, and office phone.
 */
export function WaitingCodeView({
  language,
  code,
  link,
  shareText,
  officePhone,
  justJoined,
}: {
  language: Language
  code: string
  link: string | null
  shareText: string | null
  officePhone: string
  justJoined: boolean
}) {
  const share = DISCOUNT_COPY[language]
  const markRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!justJoined) return
    rainConfetti(markRef.current)
    void spendWelcome()
  }, [justJoined])

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast(share.copied, { tone: "good" })
    } catch {
      toast(share.copyFailed, { tone: "bad" })
    }
  }

  return (
    <div className="ag-done">
      {justJoined && <FinishMark ref={markRef} />}
      <h1 className="ag-done-title">{share.doneTitle}</h1>
      <p className="ag-wt-code">{code}</p>
      {link && shareText && (
        <div className="ag-wt-col">
          <p className="ag-wt-lab">{share.linkLabel}</p>
          <p className="ag-link-box">{link}</p>
          <a href={whatsAppHref(shareText)} target="_blank" rel="noopener noreferrer" className="kit-btn kit-go kit-wide">
            <Icon name="chat" />
            <span>{share.share}</span>
          </a>
          <Button variant="ghost" size="wide" icon="copy" onClick={copyLink}>
            {share.copy}
          </Button>
        </div>
      )}
      <Note tone="wait">{share.confirmNote}</Note>
      <Note>{share.mobileWaitNote}</Note>
      <OfficeCallLine language={language} officePhone={officePhone} />
    </div>
  )
}

function ContinueButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="wide" chevron pending={pending}>
      {label}
    </Button>
  )
}

/**
 * One-time welcome greeting after setting a password (#497 state 4, #539).
 */
export function WelcomeFinishView({
  language,
  selfConfirmed,
  officePhone,
}: {
  language: Language
  selfConfirmed: boolean
  officePhone: string
}) {
  const copy = STUDENTS_COPY[language]
  const share = DISCOUNT_COPY[language]
  const markRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    rainConfetti(markRef.current)
  }, [])

  return (
    <div className="ag-done">
      <FinishMark ref={markRef} />
      <h1 className="ag-done-title">{selfConfirmed ? copy.ready : copy.approved}</h1>
      <p className="ag-done-hint">{copy.signedInNote}</p>
      <form action={continueToStudents} style={{ width: "100%" }}>
        <ContinueButton label={share.seeStudents} />
      </form>
      <OfficeCallLine language={language} officePhone={officePhone} />
    </div>
  )
}

export function OfficeCallLine({ language, officePhone }: { language: Language; officePhone: string }) {
  const call = DISCOUNT_COPY[language].call
  return (
    <div className="ag-call">
      <p>{call}</p>
      <a href={`tel:${officePhone.replaceAll(" ", "")}`} className="ag-call-link">
        <Icon name="phone" size={20} />
        <span>{officePhone}</span>
      </a>
    </div>
  )
}
