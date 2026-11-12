"use client"

import { useId } from "react"

import { Field } from "@/components/kit"
import type { AgentDraftField } from "@/lib/services/marketing-agents"

import type { AgentDraftInput } from "./actions"
import { FIELD_LABELS } from "./outcome"
import "./agents.css"

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
// database refused is marked, with the reason under it. `disabled` locks the
// fields while their values are being checked or saved.
export function AgentFields({
  fields,
  value,
  onChange,
  refused,
  disabled = false,
}: {
  fields: AgentDraftField[]
  value: AgentDraftInput
  onChange: (next: AgentDraftInput) => void
  refused?: { field?: AgentDraftField; message: string } | null
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="ag-stack">
      {fields.map((field) => {
        const key = KEYS[field]
        const invalid = refused?.field === field
        const hint = HINTS[field]
        return (
          <div key={field} className="ag-field">
            <label htmlFor={`${id}-${field}`} className="ag-label">
              {FIELD_LABELS[field]}
              {(field === "full_name" || field === "phone") && <span className="sr-only"> (required)</span>}
            </label>
            <Field
              size="compact"
              alignStart
              id={`${id}-${field}`}
              value={value[key]}
              type={field === "email" ? "email" : field === "phone" || field === "whatsapp" ? "tel" : "text"}
              inputMode={field === "phone" || field === "whatsapp" ? "tel" : undefined}
              autoComplete="off"
              spellCheck={false}
              required={field === "full_name" || field === "phone"}
              disabled={disabled}
              className={field === "code" ? "ag-mono ag-upper" : undefined}
              // On a short phone the keyboard can cover the field; keep it in view.
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
              onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              invalid={invalid}
              aria-describedby={invalid ? `${id}-${field}-error` : hint ? `${id}-${field}-hint` : undefined}
            />
            {invalid ? (
              <p id={`${id}-${field}-error`} className="ag-error">
                {refused?.message}
              </p>
            ) : (
              hint && (
                <p id={`${id}-${field}-hint`} className="ag-hint">
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
