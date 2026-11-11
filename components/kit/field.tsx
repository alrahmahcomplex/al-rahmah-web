import type { InputHTMLAttributes, ReactNode, Ref } from "react"

import { Icon, type IconName } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

export type FieldSize = "full" | "compact" | "search"

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  /** `full` 52px and 17px, `compact` 44px, `search` the 40px top-bar search on Lavender Chrome. */
  size?: FieldSize
  /** A line icon at the start, in Slate Quiet. */
  icon?: IconName
  /** Left-aligned text, for long free text and the search field. Centred otherwise. */
  alignStart?: boolean
  /** Draws the red outline and sets aria-invalid. Pair it with a FieldError linked by aria-describedby. */
  invalid?: boolean
  ref?: Ref<HTMLInputElement>
}

/**
 * The pill field (DESIGN.md, Inputs), from the Admission form's FieldInput.
 * It needs a name: a <label>, the open question's title, or aria-label where
 * the icon and placeholder carry the meaning.
 */
export function Field({ size = "full", icon, alignStart, invalid, className, ref, ...props }: FieldProps) {
  const input = (
    <input
      ref={ref}
      {...props}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      data-size={size === "full" ? undefined : size}
      data-align={alignStart || size === "search" ? "start" : undefined}
      className={cn("kit-field", className)}
    />
  )
  if (!icon) return input
  return (
    <div className="kit-fieldwrap">
      <Icon name={icon} />
      {input}
    </div>
  )
}

/**
 * The red line under a field. It folds open when `message` is set, is read
 * out at once (role="alert"), and says what to do. Give the field
 * aria-describedby={id}.
 */
export function FieldError({ id, message, alignStart }: { id: string; message?: ReactNode; alignStart?: boolean }) {
  return (
    <div className="kit-err" data-open={message ? "" : undefined} data-align={alignStart ? "start" : undefined}>
      <div>
        <p id={id} role="alert">
          {message && (
            <>
              <Icon name="alert" size={16} />
              <span>{message}</span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
