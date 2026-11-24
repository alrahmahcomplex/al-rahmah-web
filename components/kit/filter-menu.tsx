"use client"

import { Popover as BasePopover } from "@base-ui/react/popover"
import Link from "next/link"
import { useState } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./agents-parts.css"
import { RoundButton } from "./button"
import "./kit.css"

export type FilterMenuOption = {
  value: string
  label: string
  count: number
  /** When set, picking the option opens this route; otherwise `onSelect` runs. */
  href?: string
  disabled?: boolean
}

export type FilterMenuProps = {
  /** Names the filter control and its menu (e.g. "Filter" / "Chuja"). */
  label: string
  /** Current selection's readable label, announced in the trigger's accessible name. */
  currentLabel: string
  value: string
  /** Whether a non-default filter is active (draws the orange dot pip and active ring). */
  active?: boolean
  options: readonly FilterMenuOption[]
  onSelect?: (value: string) => void
  className?: string
}

/**
 * Filter button + radio dropdown with counts (prototype v5, #539): a 40px
 * round filter button with an orange dot pip when active, opening a menu of
 * radio choices with their counts and a check mark beside the active choice.
 */
export function FilterMenu({ label, currentLabel, value, active = false, options, onSelect, className }: FilterMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <span className={cn("kit-filter-wrap", className)}>
      <BasePopover.Root open={open} onOpenChange={setOpen} modal="trap-focus">
        <BasePopover.Trigger
          render={
            <RoundButton
              icon="filter"
              size={40}
              on={active}
              label={`${label}: ${currentLabel}`}
              aria-haspopup="menu"
              aria-expanded={open}
            />
          }
        />
        {active && <i className="kit-filter-pip" aria-hidden="true" />}
        <BasePopover.Portal>
          <BasePopover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={16} className="kit-pop-pos">
            <BasePopover.Popup role="menu" aria-label={label} className="kit-pop kit-filter-menu">
              {options.map((opt) => {
                const selected = opt.value === value
                const disabled = Boolean(opt.disabled) && !selected
                const inside = (
                  <>
                    <span>{opt.label}</span>
                    <small>{opt.count}</small>
                    {selected ? <Icon name="check" size={18} /> : <i aria-hidden="true" />}
                  </>
                )
                if (opt.href && !disabled) {
                  return (
                    <Link
                      key={opt.value}
                      href={opt.href}
                      role="menuitemradio"
                      aria-checked={selected}
                      className="kit-filter-opt"
                      onClick={() => setOpen(false)}
                    >
                      {inside}
                    </Link>
                  )
                }
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={disabled}
                    className="kit-filter-opt"
                    onClick={() => {
                      if (disabled) return
                      onSelect?.(opt.value)
                      setOpen(false)
                    }}
                  >
                    {inside}
                  </button>
                )
              })}
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    </span>
  )
}
