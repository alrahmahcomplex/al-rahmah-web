"use client"

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox"
import { Switch as BaseSwitch } from "@base-ui/react/switch"
import { useId, type ReactNode, type Ref } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

type TickProps = {
  /** On the hidden input, so a `<label htmlFor>` placed elsewhere names it. */
  id?: string
  /** The words to its right. Without them, name it with a `<label htmlFor={id}>` or aria-label. */
  label?: ReactNode
  /** A smaller Ink Soft line under the label; it also describes the control. */
  hint?: ReactNode
  /** Controlled. */
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  /** Uncontrolled inside a form: the field's name, first state and posted value ("on" by default). */
  name?: string
  defaultChecked?: boolean
  value?: string
  disabled?: boolean
  required?: boolean
  "aria-describedby"?: string
  "aria-label"?: string
  className?: string
  ref?: Ref<HTMLElement>
}

function Row({ kind, label, hint, hintId, disabled, className, children }: { kind: "ck" | "sw"; label?: ReactNode; hint?: ReactNode; hintId: string; disabled?: boolean; className?: string; children: ReactNode }) {
  if (!label) return <>{children}</>
  return (
    // The whole row is the target: a click on the words toggles the control inside.
    <label className={cn("kit-tick", `kit-${kind}-row`, className)} data-disabled={disabled ? "" : undefined}>
      {children}
      <span className="kit-tick-t">
        <span id={`${hintId}-l`}>{label}</span>
        {hint && <small id={hintId}>{hint}</small>}
      </span>
    </label>
  )
}

function describedBy(own: string | undefined, hintId: string, hint: ReactNode, label: ReactNode) {
  return [own, hint && label ? hintId : undefined].filter(Boolean).join(" ") || undefined
}

/**
 * The tick box (DESIGN.md, Inputs; prototype version 18): a 22px box with
 * 7px corners that fills indigo, with a white tick that grows in, and its
 * label and hint to the right. The whole row is the target, 44px high on a
 * touch screen. A tick box is saved with its form; a Switch takes effect at
 * once. On base-ui's Checkbox, as components/ui/checkbox.tsx is.
 */
export function Checkbox({ id, label, hint, checked, onCheckedChange, name, defaultChecked, value, disabled, required, className, ref, ...aria }: TickProps) {
  const hintId = useId()
  return (
    <Row kind="ck" label={label} hint={hint} hintId={hintId} disabled={disabled} className={className}>
      <BaseCheckbox.Root
        ref={ref}
        id={id}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange ? (next) => onCheckedChange(next) : undefined}
        name={name}
        value={value}
        disabled={disabled}
        required={required}
        aria-label={aria["aria-label"]}
        // A wrapping <label> does not name a role="checkbox" span; the words beside it do.
        aria-labelledby={label ? `${hintId}-l` : undefined}
        aria-describedby={describedBy(aria["aria-describedby"], hintId, hint, label)}
        className={cn("kit-ck", !label && className)}
      >
        <BaseCheckbox.Indicator keepMounted className="kit-ck-tick">
          <Icon name="check" size={16} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
    </Row>
  )
}

/**
 * The switch (prototype version 18): a 52 by 32 pill track; off has a small
 * grey knob, on is indigo with a white knob and an indigo tick. role="switch".
 * A switch takes effect at once, with no Save button; inside a form that is
 * saved later, use a Checkbox.
 */
export function Switch({ id, label, hint, checked, onCheckedChange, name, defaultChecked, value, disabled, required, className, ref, ...aria }: TickProps) {
  const hintId = useId()
  return (
    <Row kind="sw" label={label} hint={hint} hintId={hintId} disabled={disabled} className={className}>
      <BaseSwitch.Root
        ref={ref}
        id={id}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange ? (next) => onCheckedChange(next) : undefined}
        name={name}
        value={value}
        disabled={disabled}
        required={required}
        aria-label={aria["aria-label"]}
        // A wrapping <label> does not name a role="checkbox" span; the words beside it do.
        aria-labelledby={label ? `${hintId}-l` : undefined}
        aria-describedby={describedBy(aria["aria-describedby"], hintId, hint, label)}
        className={cn("kit-sw", !label && className)}
      >
        <BaseSwitch.Thumb className="kit-sw-knob">
          <Icon name="check" size={16} />
        </BaseSwitch.Thumb>
      </BaseSwitch.Root>
    </Row>
  )
}
