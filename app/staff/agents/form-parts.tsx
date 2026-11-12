"use client"

import { ChevronRightIcon } from "lucide-react"
import Link from "next/link"
import type { ComponentProps, ReactNode } from "react"
import { toast as sonnerToast } from "sonner"

import { buttonVariants } from "@/components/ui/button"
import { Checkbox as BaseCheckbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

// The Marketing Agents and Promo codes screens' long text, tick box,
// fold-open section, date, file picker and tabs, in one place (#330), and
// their toast. The
// kit builds these once in #358; until then each keeps today's control, look
// and native value, and #358's parts replace this file alone. No action
// changes either way: the date is "YYYY-MM-DD" or "", the file is the form's
// `file` value, the tick box is a boolean.

/** A multi-line text field, controlled, with `maxLength` and `aria-describedby`. */
export function TextArea(props: ComponentProps<"textarea">) {
  return <Textarea {...props} />
}

/** A tick box with its label beside it; the label names it. */
export function Checkbox({
  id,
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: ReactNode
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <BaseCheckbox id={id} className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={(next) => onCheckedChange(next === true)} />
      <Label htmlFor={id} className="font-normal text-slate-900">
        {label}
      </Label>
    </div>
  )
}

/**
 * A boxed fold-open section: the label row, then the content under it.
 * `open` opens it from outside (a field inside has an error); otherwise the
 * person opens and closes it.
 */
export function Disclosure({ label, open, children }: { label: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-xl ring-1 ring-foreground/10" open={open || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-3 text-sm font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronRightIcon aria-hidden className="ml-auto size-4 text-slate-400 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      {children}
    </details>
  )
}

/** A date, controlled: `value` and `onChange` are "YYYY-MM-DD", or "" when empty. Named by a separate <label htmlFor={id}>. */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  invalid,
  "aria-describedby": describedBy,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  invalid?: boolean
  "aria-describedby"?: string
}) {
  return (
    <Input
      id={id}
      type="date"
      value={value}
      min={min}
      max={max}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  )
}

/** A file to send with its form, uncontrolled: the form's `name` value, refused by the browser when `required` and empty. */
export function FilePicker({
  id,
  name,
  accept,
  required,
  label,
  hint,
}: {
  id: string
  name: string
  accept: string
  required?: boolean
  label: ReactNode
  hint: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type="file" accept={accept} required={required} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  )
}

/**
 * Links that switch the view, in a named <nav>: the one whose `href` is
 * `current` has aria-current="page". A label may carry a count. `children`
 * follow the tabs inside the nav (a Clear search link).
 */
export function Tabs({
  label,
  tabs,
  current,
  children,
}: {
  label: string
  tabs: { label: ReactNode; href: string }[]
  current: string | null
  children?: ReactNode
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) => {
        const on = tab.href === current
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={buttonVariants({ variant: on ? "default" : "outline", size: "sm" })}
          >
            {tab.label}
          </Link>
        )
      })}
      {children}
    </nav>
  )
}

/**
 * One sentence after a save. Only the new shell mounts the kit's Toaster, so
 * while these routes are drawn in the old shell the toast goes to its
 * Toaster; at the swap this becomes the kit's `toast`.
 */
export function toast(message: string) {
  sonnerToast(message)
}
