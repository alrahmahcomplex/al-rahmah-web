"use client"

import type { CSSProperties } from "react"
import { Toaster as Sonner, toast as sonnerToast } from "sonner"

import { Icon, type IconName } from "@/components/icons"

import type { NoteTone } from "./details"
import "./kit.css"

// The new look's toast is the app's one toast library, sonner, drawn as a
// tinted note at the bottom centre. Its toasts carry this id, so the root
// layout's Toaster (the public pages') never shows them and keeps its own look.
const TOASTER_ID = "kit"
const DURATION = 2600

// 24px up, or above the home indicator when that is taller.
const SAFE_BOTTOM = "max(24px, env(safe-area-inset-bottom, 0px))"

let shown: string | number | undefined

/**
 * Where the new look's toasts appear: bottom centre, one at a time. The new
 * shell mounts it once.
 */
export function Toaster() {
  return (
    <Sonner
      id={TOASTER_ID}
      position="bottom-center"
      visibleToasts={1}
      duration={DURATION}
      offset={{ bottom: SAFE_BOTTOM }}
      mobileOffset={{ bottom: SAFE_BOTTOM }}
      className="kit-toaster"
      // No Alt+T: the root Toaster keeps that key, and these toasts hold nothing to reach.
      hotkey={[]}
      // The pill sizes to its sentence, up to the window less 32px.
      style={{ "--width": "calc(100vw - 32px)" } as CSSProperties}
    />
  )
}

/** The note's tones: `info` for news, `good` for a save, `wait` for a warning, `bad` for a failure. */
export type ToastTone = NoteTone

const TOAST_ICON: Record<ToastTone, IconName> = { info: "info", good: "check", wait: "alert", bad: "alert" }

/**
 * Confirms a save that closed its sheet, or tells of a failure (DESIGN.md,
 * Toasts): one sentence, what happened and anything the person must do next,
 * on a faint tint with a thin line in its tone's colour. It leaves after
 * 2.6s; a new toast replaces the one showing. A `bad` toast is an alert; the
 * others are read out politely.
 */
export function toast(message: string, { tone = "info" }: { tone?: ToastTone } = {}) {
  if (shown !== undefined) sonnerToast.dismiss(shown)
  shown = sonnerToast.custom(
    () => (
      <div role={tone === "bad" ? "alert" : "status"} className="kit-toast" data-tone={tone === "info" ? undefined : tone}>
        <Icon name={TOAST_ICON[tone]} size={16} />
        <span>{message}</span>
      </div>
    ),
    { toasterId: TOASTER_ID, duration: DURATION },
  )
}
