"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

/**
 * A fold-open section (prototype version 18): a quiet indigo row whose
 * chevron turns, with the content folding open under it in 300ms (at once
 * under reduced motion). `plain` puts the chevron first (Roles "History");
 * `boxed` draws the thin indigo line with 20px corners, the label left and
 * the chevron right ("More options"). Closed content is out of the tab order.
 * `open` opens or closes it from outside, as "More options" opens when a
 * field inside it has an error; the person can still fold it after, and
 * `onOpenChange` hears each toggle.
 */
export function Disclosure({
  label,
  children,
  variant = "plain",
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
}: {
  label: ReactNode
  children: ReactNode
  variant?: "plain" | "boxed"
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const [open, setOpen] = useState(openProp ?? defaultOpen)
  const panelId = useId()

  // A new `open` from outside opens or closes it; the person can still fold it after.
  const [seen, setSeen] = useState(openProp)
  if (openProp !== seen) {
    setSeen(openProp)
    if (openProp !== undefined) setOpen(openProp)
  }

  // A field inside that is wrong when its form is sent (an unreadable date, a required field)
  // opens the section, so the person sees the field and its line.
  const panelRef = useRef<HTMLDivElement>(null)
  const changed = useRef(onOpenChange)
  const isOpen = useRef(open)
  useEffect(() => {
    changed.current = onOpenChange
    isOpen.current = open
  })
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const reveal = () => {
      if (isOpen.current) return
      isOpen.current = true
      setOpen(true)
      changed.current?.(true)
    }
    panel.addEventListener("kit:reveal", reveal)
    panel.addEventListener("invalid", reveal, true)
    return () => {
      panel.removeEventListener("kit:reveal", reveal)
      panel.removeEventListener("invalid", reveal, true)
    }
  }, [])

  const toggle = () => {
    setOpen(!open)
    onOpenChange?.(!open)
  }

  return (
    <div className={cn("kit-dsc", className)} data-variant={variant} data-open={open ? "" : undefined}>
      <button type="button" className="kit-dsc-btn" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
        {variant === "boxed" ? (
          <>
            <span>{label}</span>
            <Icon name="down" size={16} className="kit-dsc-chev" />
          </>
        ) : (
          <>
            <Icon name="down" size={16} className="kit-dsc-chev" />
            <span>{label}</span>
          </>
        )}
      </button>
      <div ref={panelRef} id={panelId} className="kit-dsc-panel">
        <div className="kit-dsc-in" inert={!open}>
          <div className="kit-dsc-body">{children}</div>
        </div>
      </div>
    </div>
  )
}
