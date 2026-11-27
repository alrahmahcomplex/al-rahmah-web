"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./agents-parts.css"
import "./kit.css"
import { toast } from "./toast"

export type CodeBlockProps = {
  /** What the block shows, line breaks kept. A secret in it can be shown masked here and given whole in `copyValue`. */
  children: ReactNode
  /** What the copy button puts on the clipboard; null leaves the button out until there is something to copy, as on the code chip. */
  copyValue: string | null
  /** The copy button's name and tooltip ("Copy command"). */
  copyLabel: string
  copiedMessage: string
  /** Said when the browser refuses the clipboard; the block then shows `copyValue` itself, selected, so it can be copied by hand. */
  copyFailedMessage: string
  /** An optional short label above the block, such as a file name. */
  label?: string
  className?: string
}

/**
 * The code block (DESIGN.md, Cards; design site round, 27 Nov 2026): a
 * command or a few lines of settings on Lavender Chrome, 16px corners, a thin
 * Indigo Line, monospace 13px, with the code chip's round copy button in its
 * top-right corner. Long lines scroll sideways inside it. When the browser
 * refuses the clipboard, the block shows what the button copies (a masked
 * secret in full) and selects it.
 */
export function CodeBlock({ children, copyValue, copyLabel, copiedMessage, copyFailedMessage, label, className }: CodeBlockProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const [byHand, setByHand] = useState(0)

  // Once the block shows the text to copy by hand, select it.
  useEffect(() => {
    const pre = preRef.current
    const selection = window.getSelection()
    if (byHand === 0 || !pre || !selection) return
    const range = document.createRange()
    range.selectNodeContents(pre)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [byHand])

  async function copy() {
    if (copyValue === null) return
    try {
      await navigator.clipboard.writeText(copyValue)
      toast(copiedMessage, { tone: "good" })
    } catch {
      setByHand((n) => n + 1)
      toast(copyFailedMessage, { tone: "bad" })
    }
  }

  return (
    <div className={cn("kit-codeblock-wrap", className)}>
      {label && <p className="kit-codeblock-label">{label}</p>}
      <div className="kit-codeblock">
        <pre ref={preRef} tabIndex={0}>
          {byHand > 0 && copyValue !== null ? copyValue : children}
        </pre>
        {copyValue !== null && (
          <button type="button" className="kit-code-copy" data-icon-host="" aria-label={copyLabel} title={copyLabel} onClick={copy}>
            <Icon name="copy" size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
