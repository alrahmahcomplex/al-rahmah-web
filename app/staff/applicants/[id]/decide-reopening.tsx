"use client"

import { useId, useState, useTransition } from "react"

import { Button, ChoiceTiles, Note, Sheet } from "@/components/kit"
import { REOPENING_REASON_MAX } from "@/lib/services/reopening-requests"

import { TextArea } from "./form-controls"
import { approveReopeningAction, rejectReopeningAction } from "./reopening-decision-actions"
import { RETAKE_LABELS, type ApprovalSeats, type DecisionOutcome } from "./reopening-decision-outcome"
import { SeatPriorityTag } from "./seat-priority-tag"

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
// sheet first. A decision that lands refreshes the page: an approved lead
// opens again, and a rejected request moves to the earlier requests with its
// reason.
export function DecideReopening(props: DecideReopeningProps) {
  return (
    <div className="lr-acts">
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
  const errorId = useId()
  const formId = useId()

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
      <Button variant="ghost" size="small" onClick={() => changeOpen(true)}>
        Approve
      </Button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`Approve reopening ${studentName}?`}
        hint={
          <>
            {admissionNumber}. {consequence}
          </>
        }
        closeLabel="Close"
        foot={
          <>
            <Button type="submit" form={formId} size="wide" pending={pending}>
              {pending ? "Approving…" : "Approve and reopen"}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} aria-disabled={pending || undefined}>
              Cancel
            </Button>
          </>
        }
      >
        <form id={formId} className="lr-form" onSubmit={approve} noValidate>
          <SeatWarning seats={seats} />
          {askRetake && (
            <ChoiceTiles
              name="retake"
              legend={<span className="lr-label">The application was declined after its interview. How does it go on?</span>}
              layout="rows"
              options={(["retake", "enrol"] as const).map((value) => ({ value, label: RETAKE_LABELS[value] }))}
              value={choice}
              onChange={(value) => {
                setChoice(value as "retake" | "enrol")
                setMissing(false)
              }}
              describedBy={missing ? errorId : undefined}
            />
          )}
          {missing && (
            <p id={errorId} role="alert" className="lr-error">
              Choose whether the applicant retakes the interview.
            </p>
          )}
          {refusal && (
            <Note tone="bad" role="alert">
              {refusal}
            </Note>
          )}
        </form>
      </Sheet>
    </>
  )
}

// Slice 9's seat warning, as the Accountant sees it before a payment, with
// the class's ranking for staff who may view payments. Advice only: the
// approver can still approve, and a failed check is a quiet note.
function SeatWarning({ seats }: { seats: ApprovalSeats }) {
  if (seats.kind === "room") return null
  if (seats.kind === "unchecked") return <p className="lr-hint">{seats.message}</p>
  return (
    <div role="alert" aria-label="Class full">
      <Note tone="wait">
        <span className="flex flex-col gap-2">
          <b>Class full</b>
          <span>{seats.message}</span>
          {seats.ranked && (
            <ol aria-label="Applicants ranked for the seats" className="lr-list max-h-56 overflow-y-auto">
              {seats.ranked.map((holder) => (
                <li
                  key={holder.leadId}
                  aria-current={holder.thisLead || undefined}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 aria-[current=true]:font-semibold"
                >
                  <span className="lr-num w-6 shrink-0">{holder.rank}.</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>
                      {holder.studentName}
                      {holder.thisLead && " (this applicant)"}
                    </span>
                    <span className="lr-num text-xs font-normal">{holder.admissionNumber}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <SeatPriorityTag priority={holder.priority} />
                    {holder.pastLastSeat && <span className="lr-error text-xs">Past the last seat</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </span>
      </Note>
    </div>
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
  const formId = useId()

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
      <Button variant="ghost" size="small" onClick={() => changeOpen(true)}>
        Reject
      </Button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`Reject reopening ${studentName}?`}
        hint={
          <>
            {admissionNumber}. The application stays closed. The person who asked reads your reason on the application.
          </>
        }
        closeLabel="Close"
        foot={
          <>
            <Button type="submit" form={formId} size="wide" pending={pending}>
              {pending ? "Rejecting…" : "Reject request"}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} aria-disabled={pending || undefined}>
              Cancel
            </Button>
          </>
        }
      >
        <form id={formId} className="lr-form" onSubmit={reject} noValidate>
          <div className="lr-field">
            <label htmlFor={reasonId} className="lr-label">
              Why is it rejected?
            </label>
            <TextArea
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
            <p id={hintId} className="lr-hint">
              Required.
            </p>
          </div>
          {missing && (
            <p id={errorId} role="alert" className="lr-error">
              Write why the request is rejected.
            </p>
          )}
          {refusal && (
            <Note tone="bad" role="alert">
              {refusal}
            </Note>
          )}
        </form>
      </Sheet>
    </>
  )
}
