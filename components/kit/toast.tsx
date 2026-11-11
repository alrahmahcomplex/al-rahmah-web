"use client"

import type { CSSProperties } from "react"
import { Toaster as Sonner, toast as sonnerToast } from "sonner"

import "./kit.css"

// The new look's toast is the app's one toast library, sonner, drawn as an
// Indigo Night pill. Its toasts carry this id, so the root layout's Toaster
// (the old shell's) never shows them and keeps its own look.
const TOASTER_ID = "kit"
const DURATION = 2600

let shown: string | number | undefined

/**
 * Where the new look's toasts appear: bottom centre, one at a time. The new
 * shell mounts it once (the kit page does until then).
 */
export function Toaster() {
  return (
    <Sonner
      id={TOASTER_ID}
      position="bottom-center"
      visibleToasts={1}
      duration={DURATION}
      offset={24}
      mobileOffset={24}
      className="kit-toaster"
      // No Alt+T: the root Toaster keeps that key, and these toasts hold nothing to reach.
      hotkey={[]}
      // The pill sizes to its sentence, up to the window less 32px.
      style={{ "--width": "calc(100vw - 32px)" } as CSSProperties}
    />
  )
}

/**
 * Confirms a save that closed its sheet (DESIGN.md, Toasts): one sentence,
 * what happened and anything the person must do next. It leaves after 2.6s;
 * a new toast replaces the one showing.
 */
export function toast(message: string) {
  if (shown !== undefined) sonnerToast.dismiss(shown)
  shown = sonnerToast.custom(
    () => (
      <div role="status" className="kit-toast">
        {message}
      </div>
    ),
    { toasterId: TOASTER_ID, duration: DURATION },
  )
}
