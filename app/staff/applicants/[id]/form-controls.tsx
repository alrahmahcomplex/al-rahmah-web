"use client"

import type { ComponentProps } from "react"

import { Field as KitField, type FieldProps } from "@/components/kit"
import { Checkbox as BaseCheckbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

// The lead record's choice list, date, date and time, long text and tick box,
// in one place. The kit's own parts are built once in #358; until then these
// keep today's look and native values (YYYY-MM-DD, the datetime-local format,
// a plain form value for the list), and #358's parts replace this file alone
// (#325). No action changes either way.

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

/** A choice list. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(SELECT_CLASS, className)} {...props} />
}

/** A date: its value is YYYY-MM-DD; `min` and `max` bound it. */
export function DateField(props: Omit<FieldProps, "type">) {
  return <KitField size="compact" alignStart type="date" {...props} />
}

/** A day and a time: its value is the datetime-local format, YYYY-MM-DDTHH:MM. */
export function DateTimeField(props: Omit<FieldProps, "type">) {
  return <KitField size="compact" alignStart type="datetime-local" {...props} />
}

/** A multi-line text field. */
export function TextArea(props: ComponentProps<"textarea">) {
  return <Textarea {...props} />
}

/** A tick box, with role="checkbox". */
export function Checkbox(props: ComponentProps<typeof BaseCheckbox>) {
  return <BaseCheckbox {...props} />
}
