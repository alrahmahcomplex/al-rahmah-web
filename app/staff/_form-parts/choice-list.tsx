"use client"

import { Select } from "@/components/kit"

// The choice list: the kit's Select (#358), one 44px size. Both names stay so
// the callers keep theirs.

export type ChoiceListOption = { value: string; label: string }

type Value = { name: string; defaultValue: string; value?: never; onValueChange?: never } | { value: string; onValueChange: (value: string) => void; name?: never; defaultValue?: never }

/** A choice list in a form. */
export function ChoiceList({
  id,
  options,
  disabled,
  "aria-describedby": describedBy,
  ...value
}: {
  id?: string
  options: ChoiceListOption[]
  disabled?: boolean
  "aria-describedby"?: string
} & Value) {
  return <Select id={id} options={options} disabled={disabled} aria-describedby={describedBy} {...value} />
}

/** A choice list that changes something at once, such as a report's period. */
export function MenuChoiceList({
  id,
  options,
  value,
  onValueChange,
  "aria-label": label,
  className,
}: {
  id?: string
  options: ChoiceListOption[]
  value: string
  onValueChange: (value: string) => void
  "aria-label": string
  /** `grow` shares a row with another list; `full` takes the row. */
  className?: "grow" | "full"
}) {
  return (
    <Select
      id={id}
      options={options}
      value={value}
      onValueChange={onValueChange}
      aria-label={label}
      className={className === "grow" ? "rp-grow" : undefined}
    />
  )
}
