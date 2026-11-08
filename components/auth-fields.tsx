"use client"

import { Eye, EyeOff, Lock, type LucideIcon } from "lucide-react"
import type { InputHTMLAttributes } from "react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The input boxes of the sign-in card (#264): an icon, then the label as the
// placeholder. A visually hidden <label> names the box for screen readers,
// and it keeps its name after the placeholder disappears.

const INPUT =
  "h-11 w-full rounded-full border border-blue-600/30 bg-white pl-10 pr-4 text-base text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600"

export const AUTH_SUBMIT = cn(
  buttonVariants({ variant: "orange" }),
  "h-11 w-full rounded-full font-exo text-base italic shadow-md shadow-orange-500/20 transition-transform hover:-translate-y-0.5 active:scale-95 disabled:opacity-70 disabled:hover:translate-y-0",
)

type FieldProps = { id: string; label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "placeholder" | "className">

export function IconField({ id, label, icon: Icon, name, ...input }: FieldProps & { icon: LucideIcon }) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
        <Icon className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
      </div>
      <input id={id} name={name ?? id} placeholder={label} className={INPUT} {...input} />
    </div>
  )
}

// A password box. With `onToggle`, it carries the show/hide eye. `shown`
// belongs to the form, so every password box on it shows or hides together.
export function PasswordField({
  id,
  label,
  shown,
  onToggle,
  toggleLabels,
  ...input
}: FieldProps & { shown: boolean; onToggle?: () => void; toggleLabels?: { show: string; hide: string } }) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
        <Lock className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
      </div>
      <input id={id} name={id} type={shown ? "text" : "password"} placeholder={label} className={cn(INPUT, "pr-10")} {...input} />
      {onToggle && toggleLabels && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={shown ? toggleLabels.hide : toggleLabels.show}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 transition-colors hover:text-slate-600 focus:outline-none"
        >
          {shown ? <EyeOff className="h-4 w-4" strokeWidth={1.5} /> : <Eye className="h-4 w-4" strokeWidth={1.5} />}
        </button>
      )}
    </div>
  )
}
