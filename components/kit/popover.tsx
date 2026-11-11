"use client"

import { Popover as BasePopover } from "@base-ui/react/popover"
import type { ReactElement, ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

export type PopoverProps = {
  /** The button that opens it, such as a 40px `RoundButton` or the person's pill. */
  trigger: ReactElement
  /** The heading, in the Card title style; it names the popover. */
  title: ReactNode
  /** A line under the heading. */
  description?: ReactNode
  /** `wide` 340px (the bell's list), `narrow` 230px (the account menu). */
  size?: "wide" | "narrow"
  /** Names a Close that only screen readers reach, so touch readers can leave it. Tab skips it; Escape closes. */
  closeLabel: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
  className?: string
}

/**
 * A menu or popover (DESIGN.md, Menus and popovers) on base-ui's Popover:
 * Paper, the Indigo Line, 22px corners, the Indigo lift, opening from its
 * button's corner. Tab stays inside; Escape and a click outside close it,
 * and focus returns to the button.
 */
export function Popover({ trigger, title, description, size = "wide", closeLabel, open, onOpenChange, children, className }: PopoverProps) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined} modal="trap-focus">
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={16} className="kit-pop-pos">
          <BasePopover.Popup data-size={size} className={cn("kit-pop", className)}>
            <BasePopover.Title className="kit-card-title">{title}</BasePopover.Title>
            {description && <BasePopover.Description className="kit-pop-desc">{description}</BasePopover.Description>}
            {children}
            <BasePopover.Close className="sr-only" tabIndex={-1}>
              {closeLabel}
            </BasePopover.Close>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}

/** Closes the popover it sits in; renders the given element, such as a kit `Button`. */
export function PopoverClose({ render }: { render: ReactElement }) {
  return <BasePopover.Close render={render} />
}
