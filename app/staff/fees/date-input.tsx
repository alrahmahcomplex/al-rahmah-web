"use client"

import type { ChangeEvent } from "react"

// The one place the Fee schedule screens draw a date field. The kit's date
// field is #358 (Redesign F7, waiting on the owner's approval of prototype
// v16); until it lands this stays today's native date input, unstyled on
// purpose, and the PR that converts these screens stays a draft. When #358
// merges, swap the body for the kit part and keep these props.
//
// value: "YYYY-MM-DD", or "" when no date is chosen (onChange gets the same).
// min, max: "YYYY-MM-DD" bounds, both optional.
export type DateInputProps = {
  id: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  invalid?: true
  "aria-describedby"?: string
}

export function DateInput({ id, value, onChange, min, max, invalid, ...rest }: DateInputProps) {
  return (
    <input
      id={id}
      type="date"
      autoComplete="off"
      value={value}
      min={min}
      max={max}
      aria-invalid={invalid}
      aria-describedby={rest["aria-describedby"]}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
  )
}
