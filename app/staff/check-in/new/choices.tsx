"use client"

import { useId } from "react"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

// The pieces of the registration screens that pick one of a few: a chip for
// each class, year or relationship, and a card for day or boarding. Each is
// the shadcn radio group, so one Tab reaches the group, the arrow keys move
// through it and Space selects. The radio itself covers its whole label, so a
// tap anywhere on a chip or card selects it, and the label shows the checked
// and focused states.

// 44px fields with 16px text, so a phone never zooms and the desk reads easily.
export const FIELD_CLASS = "h-11 rounded-lg px-3.5 text-base md:text-base"

const COVER = "absolute inset-0 size-auto aspect-auto rounded-[inherit] border-0 opacity-0 after:hidden"

type GroupProps<T extends string> = {
  id?: string
  label: string
  hint?: string
  error?: string | null
  options: readonly T[]
  value: T | ""
  onChange: (value: T) => void
}

function slug(option: string) {
  return option.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

export function ChipGroup<T extends string>({ id: idProp, label, hint, error, options, value, onChange }: GroupProps<T>) {
  const generated = useId()
  const id = idProp ?? generated
  const note = error ?? hint
  return (
    <div className="flex flex-col gap-2">
      <p id={`${id}-label`} className="text-sm leading-none font-medium">
        {label}
      </p>
      <RadioGroup
        id={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={note ? `${id}-note` : undefined}
        aria-required="true"
        aria-invalid={error ? true : undefined}
        value={value}
        onValueChange={(next) => onChange(next as T)}
        className="flex flex-wrap gap-2"
      >
        {options.map((option) => {
          const itemId = `${id}-${slug(option)}`
          return (
            <label
              key={option}
              id={`${itemId}-label`}
              htmlFor={itemId}
              className={cn(
                "relative inline-flex h-10 cursor-pointer items-center rounded-full border border-slate-300 bg-white px-3.5 text-sm font-medium transition-colors select-none text-foreground has-data-checked:border-blue-600 has-data-checked:bg-blue-600 has-data-checked:text-white has-focus-visible:ring-3 has-focus-visible:ring-blue-600/40",
                error && "border-destructive",
              )}
            >
              <RadioGroupItem id={itemId} value={option} aria-labelledby={`${itemId}-label`} className={COVER} />
              {option}
            </label>
          )
        })}
      </RadioGroup>
      {note && (
        <p id={`${id}-note`} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {note}
        </p>
      )}
    </div>
  )
}

export function CardGroup<T extends string>({
  id: idProp,
  label,
  error,
  options,
  value,
  onChange,
  describe,
}: GroupProps<T> & { describe: (option: T) => string }) {
  const generated = useId()
  const id = idProp ?? generated
  return (
    <div className="flex flex-col gap-2">
      <p id={`${id}-label`} className="text-sm leading-none font-medium">
        {label}
      </p>
      <RadioGroup
        id={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-note` : undefined}
        aria-required="true"
        aria-invalid={error ? true : undefined}
        value={value}
        onValueChange={(next) => onChange(next as T)}
        className="grid gap-2.5 sm:grid-cols-2"
      >
        {options.map((option) => {
          const itemId = `${id}-${slug(option)}`
          return (
            <label
              key={option}
              htmlFor={itemId}
              className={cn(
                "relative flex cursor-pointer flex-col gap-1 rounded-xl border border-slate-300 bg-white p-4 text-left transition-colors select-none has-data-checked:border-blue-600 has-data-checked:ring-2 has-data-checked:ring-blue-600/20 has-focus-visible:ring-3 has-focus-visible:ring-blue-600/40",
                error && "border-destructive",
              )}
            >
              <RadioGroupItem
                id={itemId}
                value={option}
                aria-labelledby={`${itemId}-title`}
                aria-describedby={`${itemId}-description`}
                className={COVER}
              />
              <span id={`${itemId}-title`} className="text-sm font-semibold text-slate-900">
                {option}
              </span>
              <span id={`${itemId}-description`} className="text-xs text-muted-foreground">
                {describe(option)}
              </span>
            </label>
          )
        })}
      </RadioGroup>
      {error && (
        <p id={`${id}-note`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// Moves focus to the first choice in a group, after a submit that found
// nothing chosen in it.
export function focusGroup(id: string) {
  document.getElementById(id)?.querySelector<HTMLElement>("[role=radio]")?.focus()
}
