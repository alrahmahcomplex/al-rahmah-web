"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

// The choice list, until #358 brings the kit's (see README.md). Both draw
// today's control; #358 replaces their insides and no caller changes.

export type ChoiceListOption = { value: string; label: string }

const NATIVE_CLASS = {
  default:
    "h-10 w-full min-w-0 staff-touch:h-11 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30",
  small:
    "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30",
}

type Value = { name: string; defaultValue: string; value?: never; onValueChange?: never } | { value: string; onValueChange: (value: string) => void; name?: never; defaultValue?: never }

/** A choice list in a form: today's native select. */
export function ChoiceList({
  id,
  options,
  size = "default",
  disabled,
  "aria-describedby": describedBy,
  ...value
}: {
  id?: string
  options: ChoiceListOption[]
  size?: "default" | "small"
  disabled?: boolean
  "aria-describedby"?: string
} & Value) {
  return (
    <select
      id={id}
      className={NATIVE_CLASS[size]}
      disabled={disabled}
      aria-describedby={describedBy}
      name={value.name}
      defaultValue={value.defaultValue}
      value={value.value}
      onChange={value.onValueChange ? (event) => value.onValueChange(event.target.value) : undefined}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** A choice list that changes something at once, such as a report's period: today's popup select. */
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
      items={Object.fromEntries(options.map((option) => [option.value, option.label]))}
      value={value}
      onValueChange={(next) => next && onValueChange(next)}
    >
      <SelectTrigger id={id} aria-label={label} className={cn(className === "grow" ? "flex-1" : "w-full")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
