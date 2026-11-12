"use client"

import { useId, useState, useTransition } from "react"

import { Button, Note } from "@/components/kit"
import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"
import { PRIOR_SIBLING_NAME_MAX, type PriorSibling } from "@/lib/services/sibling-discount"

import { Checkbox, Select } from "./form-controls"
import { Field, Input } from "./lead-editors"
import { setPriorSiblingAction } from "./prior-sibling-actions"
import { PRIOR_SIBLING_HINT, PRIOR_SIBLING_LABEL, type PriorSiblingOutcome } from "./prior-sibling-outcome"

const LOST_REQUEST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."

type Refusal = Extract<PriorSiblingOutcome, { status: "refused" }>

// The prior-sibling tick on the discount panel (#113). Ticking it opens the
// sibling's name and class; saving them gives the lead the Sibling discount.
// Unticking clears it at once. Staff without leads.edit, and everyone on a
// closed lead, see the tick and the sibling without changing them.
export function PriorSiblingTick({ leadId, sibling, canEdit }: { leadId: string; sibling: PriorSibling | null; canEdit: boolean }) {
  const checkboxId = useId()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [className, setClassName] = useState<LeadClass | "">("")
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [pending, startTransition] = useTransition()

  function save(next: { name: string; className: string } | null) {
    setRefusal(null)
    startTransition(async () => {
      let outcome: PriorSiblingOutcome
      try {
        outcome = await setPriorSiblingAction(leadId, next)
      } catch {
        outcome = { status: "refused", field: null, message: LOST_REQUEST }
      }
      if (outcome.status === "done") setEditing(false)
      else setRefusal(outcome)
    })
  }

  function edit() {
    setName(sibling?.name ?? "")
    setClassName(sibling?.className ?? "")
    setRefusal(null)
    setEditing(true)
  }

  function toggle(ticked: boolean) {
    if (ticked) edit()
    else if (editing && sibling === null) setEditing(false)
    else save(null)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    save({ name, className })
  }

  if (!canEdit && sibling === null) return null

  return (
    <div className="lr-card">
      <div className="flex items-start gap-2 text-sm">
        <Checkbox
          id={checkboxId}
          // Base UI marks a disabled checkbox with data-disabled, not :disabled.
          className="mt-0.5 data-disabled:cursor-not-allowed data-disabled:opacity-50"
          checked={sibling !== null || editing}
          disabled={!canEdit || pending}
          onCheckedChange={toggle}
        />
        <span className="flex flex-col gap-0.5">
          <label htmlFor={checkboxId} className="lr-text">
            {PRIOR_SIBLING_LABEL}
          </label>
          {sibling && !editing && (
            <span className="lr-strong">
              {sibling.name}, {sibling.className}
            </span>
          )}
          {!sibling && !editing && <span className="lr-hint">{PRIOR_SIBLING_HINT}</span>}
        </span>
        {canEdit && sibling && !editing && (
          <Button variant="ghost" size="small" className="ml-auto" onClick={edit} aria-disabled={pending || undefined}>
            Edit
          </Button>
        )}
      </div>
      {refusal && !editing && (
        <Note tone="bad" role="alert">{refusal.message}</Note>
      )}
      {editing && (
        <form aria-label="Sibling already at Al-Rahmah" className="lr-form lr-inline" onSubmit={submit}>
          {refusal && (
            <Note tone="bad" role="alert">{refusal.message}</Note>
          )}
          <Field label="Sibling's name" invalid={refusal?.field === "name"}>
            {({ id, invalid }) => (
              <Input
                id={id}
                required
                value={name}
                maxLength={PRIOR_SIBLING_NAME_MAX}
                aria-invalid={invalid || undefined}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Sibling's class" invalid={refusal?.field === "class"}>
            {({ id, invalid }) => (
              <Select
                id={id}
                required
                value={className}
                aria-invalid={invalid || undefined}
                onChange={(event) => setClassName(event.target.value as LeadClass)}
              >
                <option value="" disabled>
                  Choose a class
                </option>
                {LEAD_CLASSES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="lr-acts">
            <Button type="submit" size="small" pending={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" size="small" onClick={() => setEditing(false)} aria-disabled={pending || undefined}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
