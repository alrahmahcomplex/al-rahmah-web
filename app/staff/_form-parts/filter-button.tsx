"use client"

import { RoundButton, type RoundButtonProps } from "@/components/kit"

// The round Filter button: the kit's RoundButton with the set 2 `filter`
// icon and its `on` state (#358). It is a kit Popover's trigger, so it passes
// on whatever the trigger gives it.
export function FilterButton({
  label,
  on,
  ...props
}: Omit<RoundButtonProps, "icon" | "label" | "on"> & {
  /** The button's name, such as "Filter Visited applicants". */
  label: string
  /** The panel is filtered. */
  on: boolean
}) {
  return <RoundButton {...props} icon="filter" label={label} on={on} size={40} />
}
