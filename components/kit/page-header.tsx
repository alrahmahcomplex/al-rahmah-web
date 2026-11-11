"use client"

import { useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

import "./kit.css"

/** The id of the actions slot at the right of the page header. It replaces the old shell's HEADER_ACTIONS_ID. */
export const PAGE_ACTIONS_ID = "kit-page-actions"

/**
 * The top of a staff page (DESIGN.md, Typography): the one h1 in Exo 800
 * italic, a Slate Soft subtitle, and the actions on the right. A page passes
 * its actions here; a client part deeper in the page can add one through
 * PageActions instead.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  level = 1,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** 1 on a page. 2 only where the header is shown as an example, as on the kit page. */
  level?: 1 | 2
  className?: string
}) {
  const Heading = level === 1 ? "h1" : "h2"
  return (
    <header className={cn("kit-ph", className)}>
      <div>
        <Heading className="kit-ph-title">{title}</Heading>
        {subtitle && <p className="kit-ph-sub">{subtitle}</p>}
      </div>
      <div id={level === 1 ? PAGE_ACTIONS_ID : undefined} className="kit-ph-act">
        {actions}
      </div>
    </header>
  )
}

const subscribe = () => () => {}
const readSlot = () => document.getElementById(PAGE_ACTIONS_ID)
const noSlot = () => null

/**
 * Puts an action into the page header's slot from a client part of the page,
 * such as a form's Cancel. The slot exists only in the browser, so the server
 * renders nothing here and the action appears once the header is on screen.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(subscribe, readSlot, noSlot)
  if (!slot) return null
  return createPortal(children, slot)
}
