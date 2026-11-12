"use client"

import { FunnelIcon } from "lucide-react"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"

// The round Filter button, until #358 brings the kit's (a `filter` icon in
// set 2 and RoundButton's `on` state; see README.md): today's funnel button,
// filled while the panel is filtered. It is a kit Popover's trigger, so it
// passes on whatever the trigger gives it.
export function FilterButton({
  label,
  on,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "variant" | "size" | "aria-label"> & {
  /** The button's name, such as "Filter Visited applicants". */
  label: string
  /** The panel is filtered. */
  on: boolean
}) {
  return (
    <Button {...props} variant={on ? "secondary" : "ghost"} size="icon-sm" aria-label={label}>
      <FunnelIcon aria-hidden />
    </Button>
  )
}
