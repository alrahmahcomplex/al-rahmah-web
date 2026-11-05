"use client"

import { useId } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AgentDraftField } from "@/lib/services/marketing-agents"

import type { AgentDraftInput } from "./actions"
import { FIELD_LABELS } from "./outcome"

const KEYS: Record<AgentDraftField, keyof AgentDraftInput> = {
  full_name: "fullName",
  phone: "phone",
  whatsapp: "whatsapp",
  email: "email",
  code: "code",
}

const HINTS: Partial<Record<AgentDraftField, string>> = {
  whatsapp: "Optional. Leave empty if it is the mobile.",
  email: "Optional. Saved as confirmed by you.",
  code: "Optional. The code the agent already uses; leave empty to make a new one.",
}

// The agent's details, for the Add agent and Recreate dialogs. A field the
// database refused is marked, with the reason under it.
export function AgentFields({
  fields,
  value,
  onChange,
  refused,
}: {
  fields: AgentDraftField[]
  value: AgentDraftInput
  onChange: (next: AgentDraftInput) => void
  refused?: { field?: AgentDraftField; message: string } | null
}) {
  const id = useId()
  return (
    <div className="grid gap-3">
      {fields.map((field) => {
        const key = KEYS[field]
        const invalid = refused?.field === field
        const hint = HINTS[field]
        return (
          <div key={field} className="grid gap-1.5">
            <Label htmlFor={`${id}-${field}`}>
              {FIELD_LABELS[field]}
              {(field === "full_name" || field === "phone") && <span className="sr-only"> (required)</span>}
            </Label>
            <Input
              id={`${id}-${field}`}
              value={value[key]}
              type={field === "email" ? "email" : field === "phone" || field === "whatsapp" ? "tel" : "text"}
              inputMode={field === "phone" || field === "whatsapp" ? "tel" : undefined}
              autoComplete="off"
              spellCheck={false}
              required={field === "full_name" || field === "phone"}
              className={field === "code" ? "font-mono uppercase" : undefined}
              // On a short phone the keyboard can cover the field; keep it in view.
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
              onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${id}-${field}-error` : hint ? `${id}-${field}-hint` : undefined}
            />
            {invalid ? (
              <p id={`${id}-${field}-error`} className="text-xs text-destructive">
                {refused?.message}
              </p>
            ) : (
              hint && (
                <p id={`${id}-${field}-hint`} className="text-xs text-muted-foreground">
                  {hint}
                </p>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
