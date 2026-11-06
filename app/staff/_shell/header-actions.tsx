"use client"

import { useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"

// The slot at the right of the shell's top bar.
export const HEADER_ACTIONS_ID = "staff-header-actions"

const subscribe = () => () => {}
const readSlot = () => document.getElementById(HEADER_ACTIONS_ID)
const noSlot = () => null

// Puts a page's own action, such as Cancel, in the shell's top bar. The slot
// exists only in the browser, so the server renders nothing here and the
// action appears once the shell is on screen.
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(subscribe, readSlot, noSlot)
  if (!slot) return null
  return createPortal(children, slot)
}
