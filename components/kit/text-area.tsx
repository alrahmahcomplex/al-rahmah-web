import type { Ref, TextareaHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Draws the red outline and sets aria-invalid. Pair it with a FieldError linked by aria-describedby. */
  invalid?: boolean
  ref?: Ref<HTMLTextAreaElement>
}

/**
 * Long text (prototype version 18): the field's outline and focus ring with
 * the summary box's 20px corners, at least 96px high, left-aligned, and
 * resizable downwards. A plain textarea, so it works controlled and inside a
 * form alike, with `maxLength`, `required` and the rest.
 */
export function TextArea({ invalid, className, rows = 3, ref, ...props }: TextAreaProps) {
  return <textarea ref={ref} rows={rows} {...props} aria-invalid={invalid || props["aria-invalid"] || undefined} className={cn("kit-field kit-ta", className)} />
}
