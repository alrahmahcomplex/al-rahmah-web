"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { Icon } from "./icons"
import { prefersReducedMotion } from "./motion"
import "./guided-form.css"

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Keeps Tab inside `root`. Returns true when it moved focus. */
export function trapTab(event: KeyboardEvent | ReactKeyboardEvent, root: HTMLElement): boolean {
  if (event.key !== "Tab") return false
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden],[inert]"))
  if (items.length === 0) {
    event.preventDefault()
    return true
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault()
    last.focus()
    return true
  }
  if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault()
    first.focus()
    return true
  }
  return false
}

export type BottomSheetProps = {
  open: boolean
  onClose: () => void
  /** The sheet's heading; it takes focus when the sheet opens. */
  title: ReactNode
  /** aria-label of the round close button, e.g. "Funga". */
  closeLabel: string
  children: ReactNode
}

/**
 * A modal sheet that slides up over a frosted indigo backdrop (`.sheet-wrap`,
 * `.sheet`, `.sheet-back`). Focus moves to the title and stays inside; Escape,
 * the backdrop and the close button close it; the page behind doesn't scroll;
 * focus returns to whatever opened it.
 */
export function BottomSheet({ open, onClose, title, closeLabel, children }: BottomSheetProps) {
  const titleId = useId()
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })

  if (open && !mounted) setMounted(true)

  useLayoutEffect(() => {
    if (!open || !mounted) return
    opener.current = document.activeElement as HTMLElement | null
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = "hidden"
    // One frame below the screen, then slide up.
    const frame = requestAnimationFrame(() => setShown(true))
    heading.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close.current()
        return
      }
      if (sheet.current) trapTab(event, sheet.current)
    }
    document.addEventListener("keydown", onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("keydown", onKey)
      root.style.overflow = overflow
      setShown(false)
      const back = opener.current
      if (back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [open, mounted])

  useEffect(() => {
    if (open || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), prefersReducedMotion() ? 180 : 340)
    return () => window.clearTimeout(timer)
  }, [open, mounted])

  if (!mounted || typeof document === "undefined") return null

  return createPortal(
    <div className={`gf-sheet-wrap${shown && open ? " gf-on" : ""}`}>
      <div className="gf-sheet-back" onClick={() => close.current()} aria-hidden="true" />
      <div ref={sheet} className="gf-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} inert={!open || undefined}>
        <div className="mx-auto mb-2.5 h-1 w-10 rounded-sm bg-blue-100" aria-hidden="true" />
        <div className="mb-3.5 flex items-center gap-2">
          <h2 ref={heading} id={titleId} tabIndex={-1} className="m-0 font-exo text-xl leading-[1.25] font-extrabold text-blue-600 italic outline-none">
            {title}
          </h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => close.current()}
            className="ml-auto grid size-11 flex-none place-items-center rounded-full border-0 bg-blue-50 text-blue-600 outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40 active:scale-[0.94]"
          >
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
