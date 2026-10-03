"use client"

import { useState, useTransition } from "react"

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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { changeLeadFollowUpDate, scheduleLeadFollowUp } from "./follow-up-actions"
import { addDays, type FollowUpOutcome } from "./follow-up-outcome"
import { Field, Saved } from "./lead-editors"

const LOST_REQUEST: FollowUpOutcome = {
  status: "refused",
  field: null,
  message: "The follow-up could not be sent. Check your connection and try again.",
}

// Schedule follow-up, or Change date once a follow-up is open. Rendered for
// every open lead the staff member may plan for, so the confirmation outlasts
// the refresh that swaps one action for the other.
export function FollowUpActions({
  leadId,
  today,
  current,
}: {
  leadId: string
  // Today in Tanzania, as the server rendered the panel.
  today: string
  current: { id: string; dueOn: string } | null
}) {
  const [dialog, setDialog] = useState<"schedule" | "change" | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  function openDialog(which: "schedule" | "change") {
    setSaved(null)
    setDialog(which)
  }

  function done(message: string) {
    setDialog(null)
    setSaved(message)
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        {current ? (
          <Button type="button" variant="outline" onClick={() => openDialog("change")}>
            Change date
          </Button>
        ) : (
          <Button type="button" onClick={() => openDialog("schedule")}>
            Schedule follow-up
          </Button>
        )}
      </div>
      <Saved message={saved} />
      <Dialog open={dialog === "schedule"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          {dialog === "schedule" && <ScheduleForm leadId={leadId} today={today} onDone={done} />}
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "change"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          {dialog === "change" && current && <ChangeDateForm leadId={leadId} today={today} current={current} onDone={done} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function useSave(onDone: (message: string) => void) {
  const [refusal, setRefusal] = useState<Extract<FollowUpOutcome, { status: "refused" }> | null>(null)
  const [pending, startTransition] = useTransition()

  function save(send: () => Promise<FollowUpOutcome>) {
    setRefusal(null)
    startTransition(async () => {
      let outcome: FollowUpOutcome
      try {
        outcome = await send()
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "saved") onDone(outcome.message)
      else setRefusal(outcome)
    })
  }

  return { refusal, pending, save }
}

function Refused({ refusal }: { refusal: { message: string } | null }) {
  if (!refusal) return null
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{refusal.message}</AlertDescription>
    </Alert>
  )
}

const DATE_HINT = "Today or any day up to one year ahead."

function ScheduleForm({ leadId, today, onDone }: { leadId: string; today: string; onDone: (message: string) => void }) {
  const [dueOn, setDueOn] = useState(addDays(today, 1))
  const [note, setNote] = useState("")
  const { refusal, pending, save } = useSave(onDone)

  return (
    <form
      aria-label="Schedule follow-up"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save(() => scheduleLeadFollowUp(leadId, dueOn, note))
      }}
    >
      <DialogHeader>
        <DialogTitle>Schedule follow-up</DialogTitle>
        <DialogDescription>Plan when the school will next contact this family.</DialogDescription>
      </DialogHeader>
      <Refused refusal={refusal} />
      <Field label="Follow-up date" hint={DATE_HINT}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="date"
            required
            min={today}
            max={addDays(today, 365)}
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "due_on" ? true : undefined}
          />
        )}
      </Field>
      <Field label="Note (optional)" hint="What the contact is for. Up to 500 characters.">
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "note" ? true : undefined}
          />
        )}
      </Field>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Scheduling…" : "Schedule follow-up"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function ChangeDateForm({
  leadId,
  today,
  current,
  onDone,
}: {
  leadId: string
  today: string
  current: { id: string; dueOn: string }
  onDone: (message: string) => void
}) {
  // An overdue date can't be kept, so the form starts from tomorrow.
  const [dueOn, setDueOn] = useState(current.dueOn > today ? current.dueOn : addDays(today, 1))
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const { refusal, pending, save } = useSave(onDone)

  return (
    <form
      aria-label="Change date"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save(() => changeLeadFollowUpDate(leadId, current.id, dueOn, reason, note))
      }}
    >
      <DialogHeader>
        <DialogTitle>Change date</DialogTitle>
        <DialogDescription>The earlier date and your reason stay in the lead&apos;s history.</DialogDescription>
      </DialogHeader>
      <Refused refusal={refusal} />
      <Field label="New date" hint={DATE_HINT}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="date"
            required
            min={today}
            max={addDays(today, 365)}
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "due_on" ? true : undefined}
          />
        )}
      </Field>
      <Field label="Reason" hint="Why the date is moving, such as the parent is travelling. 3 to 500 characters.">
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "reason" ? true : undefined}
          />
        )}
      </Field>
      <Field label="New note (optional)" hint="Leave empty to keep the current note.">
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={refusal?.field === "note" ? true : undefined}
          />
        )}
      </Field>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change date"}
        </Button>
      </DialogFooter>
    </form>
  )
}
