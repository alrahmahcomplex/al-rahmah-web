"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { Button, KeyValueList, Note, Sheet } from "@/components/kit"
import { DECLINE_EXPLANATION_MAX, type DeclinedReason } from "@/lib/services/lead-closure"
import type { LeadStatus } from "@/lib/services/leads"

import { DECLINE_PARAM, linkedDeclineReason } from "../decline-link"
import { declineLeadAction } from "./decline-actions"
import type { DeclineOutcome } from "./decline-outcome"
import { Select, TextArea } from "./form-controls"

const LOST_REQUEST: DeclineOutcome = {
  status: "refused",
  message: "The decline could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// What happens next, shown before the decline is sent.
export const DECLINE_CONSEQUENCE = "This application becomes read-only. Bringing it back needs a Manager's approval."

type DeclineLeadProps = {
  lead: { id: string; studentName: string; admissionNumber: string; status: LeadStatus }
  // The reasons this staff member may pick: No seat available only for those
  // who may set the seats.
  reasons: readonly DeclinedReason[]
  // Opened from the lead's More menu, which holds whether it is open.
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Decline, in two steps: choose the reason (and explain it, for Other), then
// confirm against the lead's name and number. A decline that lands refreshes
// the page into the closed-lead banner. A link with a reason (from Seats, for
// No seat available) has the More menu open it with that reason chosen.
export function DeclineLead({ lead, reasons, open, onOpenChange: setOpen }: DeclineLeadProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const linked = linkedDeclineReason(searchParams.get(DECLINE_PARAM), reasons)
  const [step, setStep] = useState<"choose" | "confirm">("choose")
  const [reason, setReason] = useState<DeclinedReason | "">(linked ?? "")
  const [explanation, setExplanation] = useState("")
  const [missing, setMissing] = useState<"reason" | "explanation" | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const reasonId = useId()
  const explanationId = useId()
  const hintId = useId()
  const errorId = useId()
  const formId = useId()

  function changeOpen(next: boolean) {
    // A decline on its way finishes whatever the dialog does.
    if (pending) return
    setOpen(next)
    if (!next) {
      setStep("choose")
      setMissing(null)
      setRefusal(null)
      dropLinkedReason()
    }
  }

  // Closing or declining drops the link's reason from the address, so a
  // reload, even after a later reopening, doesn't open Decline again.
  function dropLinkedReason() {
    if (searchParams.has(DECLINE_PARAM)) router.replace(pathname, { scroll: false })
  }

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason === "") return setMissing("reason")
    if (reason === "Other" && explanation.trim() === "") return setMissing("explanation")
    setMissing(null)
    setRefusal(null)
    setStep("confirm")
  }

  function decline() {
    if (reason === "") return
    setRefusal(null)
    startTransition(async () => {
      let outcome: DeclineOutcome
      try {
        outcome = await declineLeadAction(lead.id, reason, explanation)
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "refused") return setRefusal(outcome.message)
      setOpen(false)
      dropLinkedReason()
    })
  }

  const note = explanation.trim()
  const error =
    missing === "reason" ? "Choose a reason." : missing === "explanation" ? "Write an explanation for Other." : null

  return (
    <Sheet
      open={open}
      onOpenChange={changeOpen}
      title={step === "choose" ? `Decline ${lead.studentName}` : `Decline ${lead.studentName}?`}
      hint={
        step === "choose" ? (
          <>
            {lead.admissionNumber} · {lead.status}. Say why the family or the school won&apos;t go ahead.
          </>
        ) : (
          DECLINE_CONSEQUENCE
        )
      }
      closeLabel="Close"
      foot={
        step === "choose" ? (
          <>
            <Button type="submit" form={formId} size="wide" chevron>
              Continue
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="wide" onClick={decline} pending={pending}>
              {pending ? "Declining…" : "Decline application"}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => setStep("choose")} aria-disabled={pending || undefined}>
              Back
            </Button>
          </>
        )
      }
    >
      {step === "choose" ? (
        <form id={formId} className="lr-form" onSubmit={review} noValidate>
          <div className="lr-field">
            <label htmlFor={reasonId} className="lr-label">
              Reason
            </label>
            <Select
              id={reasonId}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value as DeclinedReason | "")
                setMissing(null)
              }}
              aria-invalid={missing === "reason" || undefined}
              aria-describedby={missing === "reason" ? errorId : undefined}
            >
              <option value="" disabled>
                Choose a reason
              </option>
              {reasons.map((choice) => (
                <option key={choice}>{choice}</option>
              ))}
            </Select>
          </div>
          <div className="lr-field">
            <label htmlFor={explanationId} className="lr-label">
              Explanation
            </label>
            <TextArea
              id={explanationId}
              value={explanation}
              maxLength={DECLINE_EXPLANATION_MAX}
              onChange={(event) => {
                setExplanation(event.target.value)
                if (missing === "explanation") setMissing(null)
              }}
              aria-invalid={missing === "explanation" || undefined}
              aria-describedby={missing === "explanation" ? `${hintId} ${errorId}` : hintId}
            />
            <p id={hintId} className="lr-hint">
              {reason === "Other" ? "Required for Other." : "Optional. Anything the reason alone doesn't say."}
            </p>
          </div>
          {error && (
            <p id={errorId} role="alert" className="lr-error">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div className="lr-form">
          <KeyValueList
            items={[
              {
                key: "Applicant",
                value: (
                  <>
                    {lead.studentName}, <span className="lr-num whitespace-nowrap">{lead.admissionNumber}</span>
                  </>
                ),
              },
              { key: "Status now", value: lead.status },
              { key: "Reason", value: reason },
              ...(note ? [{ key: "Explanation", value: <span className="lr-pre">{note}</span> }] : []),
            ]}
          />
          {refusal && (
            <Note tone="bad" role="alert">
              {refusal}
            </Note>
          )}
        </div>
      )}
    </Sheet>
  )
}
