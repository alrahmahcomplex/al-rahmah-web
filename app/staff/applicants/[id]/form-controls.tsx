"use client"

import type { ComponentProps } from "react"

import { Checkbox as BaseCheckbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

// The lead record's select, text area and tick box, in one place. The
// prototype does not show these three yet, so they keep today's look here
// until the owner approves theirs (#325); the approved look then replaces
// this file alone.

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

/** A native select. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(SELECT_CLASS, className)} {...props} />
}

/** A multi-line text field. */
export function TextArea(props: ComponentProps<"textarea">) {
  return <Textarea {...props} />
}

/** A tick box, with role="checkbox". */
export function Checkbox(props: ComponentProps<typeof BaseCheckbox>) {
  return <BaseCheckbox {...props} />
}
