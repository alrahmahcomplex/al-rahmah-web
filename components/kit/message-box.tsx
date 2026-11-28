"use client"

import { useLayoutEffect, useRef } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./agents-parts.css"
import "./kit.css"
import "./message-box.css"
import { TextArea } from "./text-area"
import { toast } from "./toast"

export type MessageBoxProps = {
  id: string
  /** The message, which the person can change before sending it. */
  value: string
  onChange: (value: string) => void
  /** The copy button's name and tooltip ("Copy message"). */
  copyLabel: string
  copiedMessage: string
  /** Said when the browser refuses the clipboard; the message is then selected so it can be copied by hand. */
  copyFailedMessage: string
  /** The message's language, such as "sw", so a screen reader reads it right. */
  lang?: string
  "aria-label"?: string
  "aria-describedby"?: string
  className?: string
}

/**
 * The message box (DESIGN.md, Inputs; Share promo code, 28 Nov 2026): a
 * ready message to send, in the kit's text area, which grows with the text
 * so it never scrolls inside a sheet. The code block's round copy button sits
 * in its top-right corner. When the browser refuses the clipboard, the
 * message is selected so it can be copied by hand.
 */
export function MessageBox({ id, value, onChange, copyLabel, copiedMessage, copyFailedMessage, lang, className, ...aria }: MessageBoxProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grows with the text: the height the text needs, measured after each change.
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    box.style.height = "auto"
    box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`
  }, [value])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast(copiedMessage, { tone: "good" })
    } catch {
      ref.current?.focus()
      ref.current?.select()
      toast(copyFailedMessage, { tone: "bad" })
    }
  }

  return (
    <div className={cn("kit-msgbox", className)}>
      <TextArea
        ref={ref}
        id={id}
        rows={3}
        lang={lang}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"]}
      />
      <button type="button" className="kit-code-copy" data-icon-host="" aria-label={copyLabel} title={copyLabel} onClick={copy}>
        <Icon name="copy" size={16} />
      </button>
    </div>
  )
}
