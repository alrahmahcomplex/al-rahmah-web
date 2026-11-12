"use client"

import { Checkbox } from "@/components/kit"

// The tick box: the kit's Checkbox (#358), without its own label. A
// <label htmlFor={id}> beside it names it.
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
  return <Checkbox id={id} checked={checked} disabled={disabled} aria-describedby={describedBy} onCheckedChange={onCheckedChange} />
}
