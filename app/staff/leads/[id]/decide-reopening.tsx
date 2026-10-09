"use client"

import { useId, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { REOPENING_REASON_MAX } from "@/lib/services/reopening-requests"

import { approveReopeningAction, rejectReopeningAction } from "./reopening-decision-actions"
import { SeatPriorityBadge } from "../seat-priority-badge"
import { RETAKE_LABELS, type ApprovalSeats, type DecisionOutcome } from "./reopening-decision-outcome"

const LOST_REQUEST: DecisionOutcome = {
  status: "refused",
  message: "The decision could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

type DecideReopeningProps = {
  leadId: string
  requestId: string
  studentName: string
  admissionNumber: string
  // What approving does to the lead, in words.
  consequence: string
  // The lead was declined from Interviewed or Enrolled: the approver chooses
  // between a retaken interview and enrolling without one.
  askRetake: boolean
  // Whether approving would give the lead a seat in a full class (#103).
  seats: ApprovalSeats
}

// Approve and Reject, for approvers, on a Pending request. Each asks in a
// dialog first. A decision that lands refreshes the page: an approved lead
// opens again, and a rejected request moves to the earlier requests with its
// reason.
export function DecideReopening(props: DecideReopeningProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <ApproveReopening {...props} />
      <RejectReopening {...props} />
    </div>
  )
}

function useDecision() {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send(decide: () => Promise<DecisionOutcome>, done: () => void) {
    setRefusal(null)
    startTransition(async () => {
      let outcome: DecisionOutcome
      try {
        outcome = await decide()
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "refused") setRefusal(outcome.message)
      else done()
    })
  }

  return { refusal, setRefusal, pending, send }
}

function ApproveReopening({ leadId, requestId, studentName, admissionNumber, consequence, askRetake, seats }: DecideReopeningProps) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<"retake" | "enrol" | null>(null)
  const [missing, setMissing] = useState(false)
  const { refusal, setRefusal, pending, send } = useDecision()
  const legendId = useId()
  const errorId = useId()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) {
      setChoice(null)
      setMissing(false)
      setRefusal(null)
    }
  }

  function approve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (askRetake && choice === null) return setMissing(true)
    const enrolWithoutRetake = askRetake ? choice === "enrol" : null
    send(() => approveReopeningAction(leadId, requestId, enrolWithoutRetake), () => setOpen(false))
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => changeOpen(true)}>
        Approve
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className={seats.kind === "full" ? "sm:max-w-lg" : "sm:max-w-md"}>
          <form className="grid gap-4" onSubmit={approve} noValidate>
            <DialogHeader>
              <DialogTitle>Approve reopening {studentName}?</DialogTitle>
              <DialogDescription>
                {admissionNumber}. {consequence}
              </DialogDescription>
            </DialogHeader>
            <SeatWarning seats={seats} />
            {askRetake && (
              <fieldset
                className="grid gap-2"
                aria-labelledby={legendId}
                aria-invalid={missing || undefined}
                aria-describedby={missing ? errorId : undefined}
              >
                <legend id={legendId} className="mb-1 text-sm font-medium text-slate-900">
                  The lead was declined after its interview. How does it go on?
                </legend>
                {(["retake", "enrol"] as const).map((value) => (
                  <Label key={value} className="flex items-center gap-2 font-normal">
                    <input
                      type="radio"
                      name="retake"
                      value={value}
                      checked={choice === value}
                      onChange={() => {
                        setChoice(value)
                        setMissing(false)
                      }}
                      className="size-4 accent-primary"
                    />
                    {RETAKE_LABELS[value]}
                  </Label>
                ))}
              </fieldset>
            )}
            {missing && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                Choose whether the lead retakes the interview.
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
              <Button type="submit" disabled={pending}>
                {pending ? "Approving…" : "Approve and reopen"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Slice 9's seat warning, as the Accountant sees it before a payment, with
// the class's ranking for staff who may view payments. Advice only: the
// approver can still approve, and a failed check is a quiet note.
function SeatWarning({ seats }: { seats: ApprovalSeats }) {
  if (seats.kind === "room") return null
  if (seats.kind === "unchecked") return <p className="text-xs text-muted-foreground">{seats.message}</p>
  return (
    <Alert aria-label="Class full" className="border-amber-300 bg-amber-50 text-amber-950">
      <AlertTitle>Class full</AlertTitle>
      <AlertDescription className="grid gap-2 text-amber-950">
        <p>{seats.message}</p>
        {seats.ranked && (
          <ol aria-label="Leads ranked for the seats" className="flex max-h-56 flex-col divide-y divide-amber-200 overflow-y-auto">
            {seats.ranked.map((holder) => (
              <li
                key={holder.leadId}
                aria-current={holder.thisLead || undefined}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 aria-[current=true]:font-semibold"
              >
                <span className="w-6 shrink-0 tabular-nums">{holder.rank}.</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>
                    {holder.studentName}
                    {holder.thisLead && " (this lead)"}
                  </span>
                  <span className="text-xs font-normal">{holder.admissionNumber}</span>
                </span>
                <span className="flex items-center gap-2">
                  <SeatPriorityBadge priority={holder.priority} />
                  {holder.pastLastSeat && <span className="text-xs font-medium text-destructive">Past the last seat</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </AlertDescription>
    </Alert>
  )
}

function RejectReopening({ leadId, requestId, studentName, admissionNumber }: DecideReopeningProps) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [missing, setMissing] = useState(false)
  const { refusal, setRefusal, pending, send } = useDecision()
  const reasonId = useId()
  const hintId = useId()
  const errorId = useId()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) {
      setMissing(false)
      setRefusal(null)
    }
  }

  function reject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim() === "") return setMissing(true)
    send(() => rejectReopeningAction(leadId, requestId, reason), () => {
      setOpen(false)
      setReason("")
    })
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => changeOpen(true)}>
        Reject
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={reject} noValidate>
            <DialogHeader>
              <DialogTitle>Reject reopening {studentName}?</DialogTitle>
              <DialogDescription>
                {admissionNumber}. The lead stays closed. The person who asked reads your reason on the lead.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor={reasonId}>Why is it rejected?</Label>
              <Textarea
                id={reasonId}
                value={reason}
                maxLength={REOPENING_REASON_MAX}
                onChange={(event) => {
                  setReason(event.target.value)
                  setMissing(false)
                }}
                aria-invalid={missing || undefined}
                aria-describedby={missing ? `${hintId} ${errorId}` : hintId}
              />
              <p id={hintId} className="text-xs text-muted-foreground">
                Required.
              </p>
            </div>
            {missing && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                Write why the request is rejected.
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
                {pending ? "Rejecting…" : "Reject request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
