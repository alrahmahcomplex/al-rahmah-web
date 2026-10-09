"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
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
import { DECLINE_EXPLANATION_MAX, type DeclinedReason } from "@/lib/services/lead-closure"
import type { LeadStatus } from "@/lib/services/leads"

import { DECLINE_PARAM, linkedDeclineReason } from "../decline-link"
import { declineLeadAction } from "./decline-actions"
import type { DeclineOutcome } from "./decline-outcome"

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

const LOST_REQUEST: DeclineOutcome = {
  status: "refused",
  message: "The decline could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// What happens next, shown before the decline is sent.
export const DECLINE_CONSEQUENCE = "This lead becomes read-only. Bringing it back needs a Manager's approval."

type DeclineLeadProps = {
  lead: { id: string; studentName: string; admissionNumber: string; status: LeadStatus }
  // The reasons this staff member may pick: No seat available only for those
  // who may set the seats.
  reasons: readonly DeclinedReason[]
}

// Decline, in two steps: choose the reason (and explain it, for Other), then
// confirm against the lead's name and number. A decline that lands refreshes
// the page into the closed-lead banner, which replaces this panel. A link
// with a reason (from Seats, for No seat available) opens it with that reason
// chosen.
export function DeclineLead({ lead, reasons }: DeclineLeadProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const linked = linkedDeclineReason(searchParams.get(DECLINE_PARAM), reasons)
  const [open, setOpen] = useState(linked !== null)
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

  function changeOpen(next: boolean) {
    // A decline on its way finishes whatever the dialog does.
    if (pending) return
    setOpen(next)
    if (!next) {
      setStep("choose")
      setMissing(null)
      setRefusal(null)
      // Closing drops the link's reason from the address, so a reload
      // doesn't open Decline again.
      if (searchParams.has(DECLINE_PARAM)) router.replace(pathname, { scroll: false })
    }
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
      if (outcome.status === "refused") setRefusal(outcome.message)
      else setOpen(false)
    })
  }

  const note = explanation.trim()
  const error =
    missing === "reason" ? "Choose a reason." : missing === "explanation" ? "Write an explanation for Other." : null

  return (
    <>
      <Button type="button" variant="outline" onClick={() => changeOpen(true)}>
        Decline
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          {step === "choose" ? (
            <form className="grid gap-4" onSubmit={review} noValidate>
              <DialogHeader>
                <DialogTitle>Decline {lead.studentName}</DialogTitle>
                <DialogDescription>
                  {lead.admissionNumber} · {lead.status}. Say why the family or the school won&apos;t go ahead.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor={reasonId}>Reason</Label>
                <select
                  id={reasonId}
                  className={SELECT_CLASS}
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
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={explanationId}>Explanation</Label>
                <Textarea
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
                <p id={hintId} className="text-xs text-muted-foreground">
                  {reason === "Other" ? "Required for Other." : "Optional. Anything the reason alone doesn't say."}
                </p>
              </div>
              {error && (
                <p id={errorId} role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => changeOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Continue</Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Decline {lead.studentName}?</DialogTitle>
                <DialogDescription>{DECLINE_CONSEQUENCE}</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Lead</dt>
                <dd className="text-slate-900">
                  {lead.studentName}, <span className="font-mono whitespace-nowrap">{lead.admissionNumber}</span>
                </dd>
                <dt className="text-muted-foreground">Status now</dt>
                <dd className="text-slate-900">{lead.status}</dd>
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="text-slate-900">{reason}</dd>
                {note && (
                  <>
                    <dt className="text-muted-foreground">Explanation</dt>
                    <dd className="whitespace-pre-line break-words text-slate-900">{note}</dd>
                  </>
                )}
              </dl>
              {refusal && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{refusal}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStep("choose")} disabled={pending}>
                  Back
                </Button>
                <Button type="button" variant="destructive" onClick={decline} disabled={pending}>
                  {pending ? "Declining…" : "Decline lead"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
