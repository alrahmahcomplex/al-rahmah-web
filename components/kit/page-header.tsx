"use client"

import Link from "next/link"
import { Fragment, useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

/** The id of the actions slot at the right of the page header. */
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
  count,
  countLabel,
  trail,
  level = 1,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** A total after the title, in a pill of the title's height, such as the year's interviews. */
  count?: number
  /** The count's name for a screen reader, such as "142 interviews". */
  countLabel?: string
  /** The pages before this one, each a link, as on a record reached from a list. */
  trail?: readonly TrailStep[]
  /** 1 on a page. 2 only where the header is shown as an example, as on the kit page. */
  level?: 1 | 2
  className?: string
}) {
  const Heading = level === 1 ? "h1" : "h2"
  return (
    <header className={cn("kit-ph", className)}>
      <div>
        <div className="kit-ph-line">
          {trail && <TitleTrail steps={trail} />}
          <Heading className="kit-ph-title">{title}</Heading>
          {count !== undefined && <TitleCount count={count} label={countLabel} />}
        </div>
        {subtitle && <p className="kit-ph-sub">{subtitle}</p>}
      </div>
      <div id={level === 1 ? PAGE_ACTIONS_ID : undefined} className="kit-ph-act">
        {actions}
      </div>
    </header>
  )
}

export type TrailStep = { label: string; href: string }

/** The pages before the title, each a link in the title's size, then a chevron. */
export function TitleTrail({ steps }: { steps: readonly TrailStep[] }) {
  return (
    <>
      {steps.map((step) => (
        <Fragment key={step.href}>
          <Link href={step.href} className="kit-ph-trail">
            {step.label}
          </Link>
          <Icon name="right" size={24} className="kit-ph-sep" />
        </Fragment>
      ))}
    </>
  )
}

/** A total in a pill of the title's height, after the title. */
export function TitleCount({ count, label }: { count: number; label?: string }) {
  return (
    <span className="kit-ph-count" role="img" aria-label={label ?? String(count)}>
      {count}
    </span>
  )
}

const subscribe = () => () => {}
const readSlot = () => document.getElementById(PAGE_ACTIONS_ID)
const noSlot = () => null

/**
 * Puts an action, such as a form's Cancel, into the page header's slot from a
 * client part of the page. The slot exists only in the browser, so the server
 * renders nothing here and the action appears once the header is on screen.
 * The slot is found once, on mount: keep this under the same page as its
 * header, so the two mount and unmount together.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(subscribe, readSlot, noSlot)
  if (!slot) return null
  return createPortal(children, slot)
}
