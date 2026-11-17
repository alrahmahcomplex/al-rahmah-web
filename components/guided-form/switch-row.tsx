"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { Icon } from "./icons"
import "./guided-form.css"

/**
 * A whole-row switch (prototype v38, "The father is the custodian"): a real
 * checkbox with `role="switch"`, the track and knob on the left, the label
 * and a small line under it. The row tints Lavender Whisper with an indigo
 * line while on. For the public forms: the kit's Switch needs kit.css.
 */
export function SwitchRow({
  id,
  label,
  detail,
  checked,
  onCheckedChange,
  className,
  "aria-describedby": describedBy,
}: {
  id: string
  label: ReactNode
  /** The small line under the label, such as the father's full name. */
  detail?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
  "aria-describedby"?: string
}) {
  return (
    <label htmlFor={id} className={cn("gf-swrow", className)}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        aria-describedby={[detail ? `${id}-detail` : null, describedBy].filter(Boolean).join(" ") || undefined}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span className="gf-trk" aria-hidden="true">
        <span className="gf-knb">
          <Icon name="check" />
        </span>
      </span>
      <span className="gf-swt">
        <b>{label}</b>
        {detail && <small id={`${id}-detail`}>{detail}</small>}
      </span>
    </label>
  )
}

/** A part that folds open and shut. Shut, it is `inert`, so Tab skips it. */
export function Reveal({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={cn("gf-reveal", open && "gf-on")} inert={!open}>
      <div>{children}</div>
    </div>
  )
}
