"use client"

import { useId, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CLOSURE_NOTE_MAX, CLOSURE_REASONS, type ClosureReason, type MarkMove } from "@/lib/services/lead-closure"
import type { LeadStatus } from "@/lib/services/leads"

import { markLeadAction } from "./mark-actions"
import type { MarkOutcome } from "./mark-outcome"
import { MARK_LABEL, markConsequence, markTitle } from "./mark-text"

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

const LOST_REQUEST: MarkOutcome = {
  status: "refused",
  message: "The mark could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

type MarkLeadProps = {
  lead: { id: string; studentName: string; admissionNumber: string; status: LeadStatus }
  mark: MarkMove
}

// Mark inactive or Archive: choose the reason, add a note if it helps, and
// send. A mark that lands refreshes the page into the closed-lead banner.
export function MarkLead({ lead, mark }: MarkLeadProps) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ClosureReason | "">("")
  const [note, setNote] = useState("")
  const [missing, setMissing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const reasonId = useId()
  const noteId = useId()
  const hintId = useId()
  const errorId = useId()
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
    <>
      <Button type="button" variant="outline" onClick={() => changeOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={send} noValidate>
            <DialogHeader>
              <DialogTitle>{markTitle(mark, lead.studentName)}</DialogTitle>
              <DialogDescription>
                {lead.admissionNumber}. {markConsequence(mark, lead.status)}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor={reasonId}>Reason</Label>
              <select
                id={reasonId}
                className={SELECT_CLASS}
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
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={noteId}>Note</Label>
              <Textarea
                id={noteId}
                value={note}
                maxLength={CLOSURE_NOTE_MAX}
                onChange={(event) => setNote(event.target.value)}
                aria-describedby={hintId}
              />
              <p id={hintId} className="text-xs text-muted-foreground">
                Optional. Anything the reason alone doesn&apos;t say.
              </p>
            </div>
            {missing && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                Choose a reason.
              </p>
            )}
            {refusal && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{refusal}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Saving…" : label}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
