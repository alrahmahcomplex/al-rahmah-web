"use client"

import { useId, useState, useTransition } from "react"

import { Button, Note, Sheet } from "@/components/kit"
import { CLOSURE_NOTE_MAX, CLOSURE_REASONS, type ClosureReason, type MarkMove } from "@/lib/services/lead-closure"
import type { LeadStatus } from "@/lib/services/leads"

import { TextArea, Select } from "./form-controls"
import { markLeadAction } from "./mark-actions"
import type { MarkOutcome } from "./mark-outcome"
import { MARK_LABEL, markConsequence, markTitle } from "./mark-text"

const LOST_REQUEST: MarkOutcome = {
  status: "refused",
  message: "The mark could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

type MarkLeadProps = {
  lead: { id: string; studentName: string; admissionNumber: string; status: LeadStatus }
  mark: MarkMove
  // Opened from the lead's More menu, which holds whether it is open.
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Mark inactive or Archive: choose the reason, add a note if it helps, and
// send. A mark that lands refreshes the page into the closed-lead banner.
export function MarkLead({ lead, mark, open, onOpenChange: setOpen }: MarkLeadProps) {
  const [reason, setReason] = useState<ClosureReason | "">("")
  const [note, setNote] = useState("")
  const [missing, setMissing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const reasonId = useId()
  const noteId = useId()
  const hintId = useId()
  const errorId = useId()
  const formId = useId()
  const label = MARK_LABEL[mark]

  function changeOpen(next: boolean) {
    // A mark on its way finishes whatever the dialog does.
    if (pending) return
    setOpen(next)
    if (!next) {
      setMissing(false)
      setRefusal(null)
    }
  }

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason === "") return setMissing(true)
    setMissing(false)
    setRefusal(null)
    startTransition(async () => {
      let outcome: MarkOutcome
      try {
        outcome = await markLeadAction(lead.id, mark, reason, note)
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "refused") setRefusal(outcome.message)
      else setOpen(false)
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={changeOpen}
      title={markTitle(mark, lead.studentName)}
      hint={
        <>
          {lead.admissionNumber}. {markConsequence(mark, lead.status)}
        </>
      }
      closeLabel="Close"
      foot={
        <>
          <Button type="submit" form={formId} size="wide" pending={pending}>
            {pending ? "Saving…" : label}
          </Button>
          <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} aria-disabled={pending || undefined}>
            Cancel
          </Button>
        </>
      }
    >
      <form id={formId} className="lr-form" onSubmit={send} noValidate>
        <div className="lr-field">
          <label htmlFor={reasonId} className="lr-label">
            Reason
          </label>
          <Select
            id={reasonId}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value as ClosureReason | "")
              setMissing(false)
            }}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? errorId : undefined}
          >
            <option value="" disabled>
              Choose a reason
            </option>
            {CLOSURE_REASONS.map((choice) => (
              <option key={choice}>{choice}</option>
            ))}
          </Select>
        </div>
        <div className="lr-field">
          <label htmlFor={noteId} className="lr-label">
            Note
          </label>
          <TextArea
            id={noteId}
            value={note}
            maxLength={CLOSURE_NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby={hintId}
          />
          <p id={hintId} className="lr-hint">
            Optional. Anything the reason alone doesn&apos;t say.
          </p>
        </div>
        {missing && (
          <p id={errorId} role="alert" className="lr-error">
            Choose a reason.
          </p>
        )}
        {refusal && (
          <Note tone="bad" role="alert">
            {refusal}
          </Note>
        )}
      </form>
    </Sheet>
  )
}
