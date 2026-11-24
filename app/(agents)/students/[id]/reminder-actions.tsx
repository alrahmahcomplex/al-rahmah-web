"use client"

import { Icon } from "@/components/icons"
import { Button, toast } from "@/components/kit"
import type { Language } from "@/lib/language"

import { AGENTS_COPY, DISCOUNT_COPY, STUDENTS_COPY, whatsAppHref } from "../../copy"

/**
 * Reminder actions on /students/[id] (prototype v5, #539): orange Open
 * WhatsApp (no phone number; the agent picks the chat) and outlined Copy the
 * SMS message.
 */
export function StudentReminderActions({ language, message }: { language: Language; message: string }) {
  const copy = AGENTS_COPY[language]
  const studentsCopy = STUDENTS_COPY[language]
  const share = DISCOUNT_COPY[language]

  async function copySms() {
    try {
      await navigator.clipboard.writeText(message)
      toast(copy.smsCopied, { tone: "good" })
    } catch {
      toast(share.copyFailed, { tone: "bad" })
    }
  }

  return (
    <div className="ag-acts">
      <a href={whatsAppHref(message)} target="_blank" rel="noopener noreferrer" className="kit-btn kit-go kit-wide">
        <Icon name="chat" />
        <span>{studentsCopy.openWhatsApp}</span>
      </a>
      <Button variant="ghost" size="wide" icon="copy" onClick={copySms}>
        {copy.copySms}
      </Button>
    </div>
  )
}
