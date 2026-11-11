"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

export type FilterOption = { value: string; label: ReactNode }

/**
 * The row of 36px filter pills above a list (DESIGN.md, Lists). Each pill is
 * a toggle button with aria-pressed; the pressed one turns indigo with Exo
 * italic. `children` follow the pills: a Line tag, a Clear link.
 */
export function FilterPills({
  label,
  options,
  value,
  onChange,
  className,
  children,
}: {
  /** The group's name for a screen reader, such as "Filter by status". */
  label: string
  options: FilterOption[]
  value: string
  onChange: (value: string) => void
  className?: string
  children?: ReactNode
}) {
  return (
    <div role="group" aria-label={label} className={cn("kit-tools", className)}>
      {options.map((option) => (
        <button key={option.value} type="button" className="kit-fpill" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
      {children}
    </div>
  )
}
