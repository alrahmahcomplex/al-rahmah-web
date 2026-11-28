"use client"

import { useState } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import type { FieldProps } from "./field"
import "./kit.css"

export type PasswordFieldProps = Omit<FieldProps, "type" | "icon" | "alignStart" | "size"> & {
  /** The eye button's name while the password is hidden ("Show password"). */
  showLabel: string
  /** Its name while the password shows ("Hide password"). */
  hideLabel: string
}

/**
 * The password field (DESIGN.md, Inputs; design site round, 27 Nov 2026): the
 * pill field with the lock icon at the start and a 36px round eye button
 * inside its right end. Pressed, the password shows and the eye is struck
 * through. It needs a name, like Field: a <label> or aria-label.
 */
export function PasswordField({ showLabel, hideLabel, invalid, className, ref, ...props }: PasswordFieldProps) {
  const [shown, setShown] = useState(false)
  return (
    <div className="kit-fieldwrap kit-pass">
      <Icon name="lock" />
      <input
        ref={ref}
        {...props}
        type={shown ? "text" : "password"}
        aria-invalid={invalid || props["aria-invalid"] || undefined}
        className={cn("kit-field", className)}
      />
      <button
        type="button"
        className="kit-pass-eye"
        data-icon-host=""
        aria-label={shown ? hideLabel : showLabel}
        aria-pressed={shown}
        onClick={() => setShown((now) => !now)}
      >
        <Icon name={shown ? "eye-off" : "eye"} />
      </button>
    </div>
  )
}
