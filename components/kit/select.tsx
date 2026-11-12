"use client"

import { Select as BaseSelect } from "@base-ui/react/select"
import { useEffect, useRef, useState, type Ref } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

export type SelectOption = { value: string; label: string; disabled?: boolean }

export type SelectProps = {
  /** The choices in order. `""` may be a real choice ("Anyone", "Blank role"). */
  options: SelectOption[]
  /** What the empty field says, and the quiet heading inside the open list ("Choose a type"). Never a choice. */
  placeholder?: string
  /** Controlled: the chosen option's value. A value no option has shows the placeholder. */
  value?: string
  onValueChange?: (value: string) => void
  /** Uncontrolled inside a form: the field's name and first value. The form posts the chosen option's value. */
  name?: string
  defaultValue?: string
  /** On the button, so a `<label htmlFor>` names it. */
  id?: string
  required?: boolean
  disabled?: boolean
  /** Draws the red outline and sets aria-invalid. Pair it with a FieldError linked by aria-describedby. */
  invalid?: boolean
  "aria-invalid"?: boolean | "true" | "false"
  "aria-describedby"?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  className?: string
  ref?: Ref<HTMLButtonElement>
}

/**
 * The choice list (DESIGN.md, Inputs; prototype version 18): the 44px pill
 * field as a button with a chevron that turns, opening our own list as wide as
 * the field, below it or above it when there is no room. Items are pills:
 * Lavender Mist under the pointer and the keyboard, the chosen one indigo with
 * a white tick. Keyboard: arrows, Home, End, Enter, Space and type-ahead;
 * Escape closes the list only, never the Sheet or Popover around it. Built on
 * base-ui's Select, so it is announced as a form field and posts its value
 * like a native select.
 */
export function Select({
  options,
  placeholder,
  value,
  onValueChange,
  name,
  defaultValue = "",
  id,
  required,
  disabled,
  invalid,
  className,
  ref,
  ...aria
}: SelectProps) {
  const [inner, setInner] = useState(defaultValue)
  const controlled = value !== undefined
  const current = controlled ? value : inner
  const chosen = options.find((option) => option.value === current)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Uncontrolled, a form's reset puts the first value back, as a native select does.
  useEffect(() => {
    const form = inputRef.current?.form
    if (controlled || !form) return
    const reset = () => setInner(defaultValue)
    form.addEventListener("reset", reset)
    return () => form.removeEventListener("reset", reset)
  }, [controlled, defaultValue])

  return (
    <BaseSelect.Root
      items={options}
      value={current}
      onValueChange={(next) => {
        if (typeof next !== "string") return
        if (!controlled) setInner(next)
        onValueChange?.(next)
      }}
      name={name}
      inputRef={inputRef}
      required={required}
      disabled={disabled}
      modal={false}
      onOpenChange={(open) => {
        if (!open) return
        // As the prototype, the open list marks the chosen item, or the first, even when a click opened it.
        requestAnimationFrame(() => {
          const list = listRef.current
          if (!list || list.querySelector("[data-highlighted]")) return
          list.querySelector<HTMLElement>("[role=option][data-selected]:not([data-disabled]), [role=option]:not([data-disabled])")?.focus({ preventScroll: true })
        })
      }}
    >
      <BaseSelect.Trigger
        ref={ref}
        id={id}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"]}
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={invalid || aria["aria-invalid"] === true || aria["aria-invalid"] === "true" || undefined}
        data-empty={chosen ? undefined : ""}
        className={cn("kit-field kit-sel", className)}
      >
        <span className="kit-sel-v">{chosen ? chosen.label : placeholder}</span>
        <Icon name="down" size={16} className="kit-sel-chev" />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} alignItemWithTrigger={false} className="kit-up-pos">
          <BaseSelect.Popup className="kit-up kit-sel-pop">
            {placeholder && (
              <p className="kit-sel-head" aria-hidden="true">
                {placeholder}
              </p>
            )}
            <BaseSelect.List ref={listRef} className="kit-sel-list">
              {options.map((option) => (
                <BaseSelect.Item key={option.value} value={option.value} label={option.label} disabled={option.disabled} className="kit-sel-o">
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  <Icon name="check" size={18} />
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
