"use client"

import { cloneElement, useEffect, useState, type ReactElement } from "react"

import { cn } from "@/lib/utils"

import "./picked.css"

/**
 * Tooltips A, light (prototype v38): a short name for an icon button, white
 * with a thin line and a soft shadow, above the button on hover and on
 * keyboard focus. Escape hides it, wherever focus is, until the pointer or
 * focus leaves. The button keeps its own name (RoundButton's `label`), so the
 * tooltip is not read out a second time, and the browser's own title tooltip
 * is dropped.
 */
export function Tooltip({ label, children, className }: { label: string; children: ReactElement<{ title?: string }>; className?: string }) {
  const [dismissed, setDismissed] = useState(false)
  const [hovered, setHovered] = useState(false)

  // A tooltip shown by the pointer has no focus inside it, so Escape is heard on the document.
  useEffect(() => {
    if (!hovered || dismissed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [hovered, dismissed])

  return (
    <span
      className={cn("kit-tipw", className)}
      data-dismissed={dismissed ? "" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !dismissed) setDismissed(true)
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false)
        setDismissed(false)
      }}
      onBlur={() => setDismissed(false)}
    >
      {cloneElement(children, { title: undefined })}
      <span className="kit-tip" aria-hidden="true">
        {label}
      </span>
    </span>
  )
}
