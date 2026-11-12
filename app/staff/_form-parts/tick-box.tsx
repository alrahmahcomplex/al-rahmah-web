"use client"

import { Checkbox } from "@/components/ui/checkbox"

// The tick box, until #358 brings the kit's (see README.md): today's
// Checkbox. A <label htmlFor={id}> names it.
export function TickBox({
  id,
  checked,
  disabled,
  onCheckedChange,
  "aria-describedby": describedBy,
}: {
  id: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  "aria-describedby"?: string
}) {
  return (
    <Checkbox
      id={id}
      // Base UI marks a disabled checkbox with data-disabled, not :disabled.
      className="mt-0.5 data-disabled:cursor-not-allowed data-disabled:opacity-50"
      checked={checked}
      disabled={disabled}
      aria-describedby={describedBy}
      onCheckedChange={(next) => onCheckedChange(next)}
    />
  )
}
