"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import { Button, RoundButton } from "./button"
import "./kit.css"

export type SheetPlacement = "bottom" | "centre" | "side"

export type SheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * `centre` (a review or a confirmation) and `side` (a row's record) from
   * 720px; below that every sheet rises from the bottom. `bottom` always
   * rises from the bottom.
   */
  placement?: SheetPlacement
  /** The sheet's name, in the Question style. Focus moves here on open. */
  title: ReactNode
  /** A Slate Quiet line under the title; it also describes the dialog. */
  hint?: ReactNode
  /** Chips under the title, such as the record's status. */
  chips?: ReactNode
  /** The 36px Close button's name. */
  closeLabel: string
  /** The fixed foot: the Go button, then the Ghost button, both `size="wide"`. */
  foot?: ReactNode
  /** The details: the only part that scrolls. */
  children: ReactNode
  className?: string
}

/** How far the on-screen keyboard covers the bottom of the window, and the height left above it. */
function useKeyboardInset(active: boolean) {
  const [inset, setInset] = useState<{ cover: number; height: number } | null>(null)
  useEffect(() => {
    const view = window.visualViewport
    if (!active || !view) return
    const update = () => setInset({ cover: Math.max(0, window.innerHeight - view.height - view.offsetTop), height: view.height })
    update()
    view.addEventListener("resize", update)
    view.addEventListener("scroll", update)
    return () => {
      view.removeEventListener("resize", update)
      view.removeEventListener("scroll", update)
      setInset(null)
    }
  }, [active])
  return inset
}

/**
 * A sheet (DESIGN.md, Sheets and dialogs) on base-ui's Dialog: a fixed head
 * (title, hint, chips, Close), a body that alone scrolls, and a fixed foot.
 * Escape and the backdrop close it; focus moves to the title, stays inside,
 * and returns to the opener. On a phone the foot stays above the keyboard.
 */
export function Sheet({ open, onOpenChange, placement = "centre", title, hint, chips, closeLabel, foot, children, className }: SheetProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const inset = useKeyboardInset(open)
  const style = inset ? ({ "--kit-kb": `${inset.cover}px`, "--kit-vvh": `${inset.height}px` } as CSSProperties) : undefined

  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="kit-sheet-back" />
        <Dialog.Popup initialFocus={titleRef} data-placement={placement} className={cn("kit-sheet", className)} style={style}>
          <div className="kit-sheet-head">
            <Dialog.Title ref={titleRef} tabIndex={-1} className="kit-sheet-title">
              {title}
            </Dialog.Title>
            {hint && <Dialog.Description className="kit-sheet-hint">{hint}</Dialog.Description>}
            {chips && <div>{chips}</div>}
            <Dialog.Close render={<RoundButton icon="x" label={closeLabel} size={36} className="kit-sheet-x" />} />
          </div>
          <div className="kit-sheet-body" tabIndex={0}>
            {children}
          </div>
          {foot && <div className="kit-sheet-foot">{foot}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * A small edit inside an open sheet's body (a fee, a name, a previous
 * school), below a dashed line, with a small Save and Cancel. Not a second
 * sheet. When it closes, focus goes back to whatever opened it.
 */
export function InlineEditor({
  onSave,
  onCancel,
  saveLabel,
  cancelLabel,
  children,
  className,
}: {
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  cancelLabel: string
  children: ReactNode
  className?: string
}) {
  const formRef = useRef<HTMLFormElement>(null)
  // The element that opened the editor, read while it still has focus.
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)))

  useEffect(() => {
    const form = formRef.current
    return () => {
      // Still in the page: React's development re-run of effects, not a real close.
      if (form?.isConnected) return
      const lost = !document.activeElement || document.activeElement === document.body || form?.contains(document.activeElement)
      if (lost && opener?.isConnected) opener.focus()
    }
  }, [opener])

  return (
    <form
      ref={formRef}
      noValidate
      className={cn("kit-inline", className)}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        onSave()
      }}
    >
      {children}
      <div className="kit-inline-act">
        <Button type="submit" size="small">
          {saveLabel}
        </Button>
        <Button variant="ghost" size="small" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </form>
  )
}
