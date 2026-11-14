"use client"

import { cloneElement, useState, type ReactElement } from "react"

import { cn } from "@/lib/utils"

import "./picked.css"

/**
 * Tooltips A, light (prototype v38): a short name for an icon button, white
 * with a thin line and a soft shadow, above the button on hover and on
 * keyboard focus. Escape hides it until the pointer or focus leaves. The
 * button keeps its own name (RoundButton's `label`), so the tooltip is not
 * read out a second time, and the browser's own title tooltip is dropped.
 */
export function Tooltip({ label, children, className }: { label: string; children: ReactElement<{ title?: string }>; className?: string }) {
  const [dismissed, setDismissed] = useState(false)
  return (
    <span
      className={cn("kit-tipw", className)}
      data-dismissed={dismissed ? "" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !dismissed) setDismissed(true)
      }}
      onPointerLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
    >
      {cloneElement(children, { title: undefined })}
      <span className="kit-tip" aria-hidden="true">
        {label}
      </span>
    </span>
  )
}
