"use client"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./agents-parts.css"
import "./kit.css"
import { toast } from "./toast"

export type CodeChipProps = {
  /** Monospace code shown in the chip (e.g. "ABC-123"). */
  code: string
  /** Screen-reader prefix before the code (e.g. "Your code" / "Code yako"). */
  prefix: string
  /** Text copied to the clipboard when the copy icon is pressed (typically the referral link). */
  copyValue: string | null
  /** Accessible label and tooltip for the copy button. */
  copyLabel: string
  copiedMessage: string
  copyFailedMessage: string
  className?: string
}

/**
 * Outlined code pill with a 30px round copy icon button (prototype v5, #539).
 */
export function CodeChip({ code, prefix, copyValue, copyLabel, copiedMessage, copyFailedMessage, className }: CodeChipProps) {
  async function handleCopy() {
    if (!copyValue) return
    try {
      await navigator.clipboard.writeText(copyValue)
      toast(copiedMessage, { tone: "good" })
    } catch {
      toast(copyFailedMessage, { tone: "bad" })
    }
  }

  return (
    <p className={cn("kit-code-chip", className)}>
      <span className="sr-only">{prefix} </span>
      <b>{code}</b>
      {copyValue && (
        <button type="button" className="kit-code-copy" aria-label={copyLabel} title={copyLabel} onClick={handleCopy}>
          <Icon name="copy" size={16} />
        </button>
      )}
    </p>
  )
}
