"use client"

import { Eye, EyeOff, Lock } from "lucide-react"

export const INPUT =
  "h-11 w-full rounded-full border border-blue-600/30 bg-white pl-10 pr-10 font-exo text-[14px] text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600"

export const SUBMIT =
  "h-11 w-full rounded-full bg-orange-500 font-exo text-base font-bold italic text-white shadow-md shadow-orange-500/20 transition-transform hover:-translate-y-0.5 hover:bg-orange-600 active:scale-95 disabled:opacity-70 disabled:hover:translate-y-0"

// A password box, with the show/hide toggle on the first one. `shown` belongs
// to the form, so every password box on it shows or hides together.
export function PasswordField({
  id,
  label,
  autoComplete,
  shown,
  onToggle,
  toggleLabels,
  describedBy,
  minLength,
}: {
  id: string
  label: string
  autoComplete: string
  shown: boolean
  onToggle?: () => void
  toggleLabels?: { show: string; hide: string }
  describedBy?: string
  minLength?: number
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="pl-4 font-exo text-[13px] font-bold italic text-slate-700">
        {label}
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          <Lock className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
        </div>
        <input
          id={id}
          name={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          className={INPUT}
          required
          minLength={minLength}
          aria-describedby={describedBy}
        />
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
    </div>
  )
}
