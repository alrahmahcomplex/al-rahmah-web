"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

// Choice rows, segmented choices and the default tile are the Admission
// form's own components, unchanged (DESIGN.md, Choices).
export { ChoiceTiles, DefaultTile, type ChoiceOption, type ChoiceTilesProps } from "@/components/guided-form/controls"

export type ChipOption = { value: string; label: ReactNode }

/**
 * Chip buttons: 40px pills for many short options, one pressed at a time.
 * Toggle buttons in a named group, so each says whether it is pressed.
 */
export function ChipButtons({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** The group's name, usually the open question. */
  label: string
  options: ChipOption[]
  value: string | null
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn("kit-chips", className)}>
      {options.map((option) => (
        <button key={option.value} type="button" className="kit-chipb" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}
