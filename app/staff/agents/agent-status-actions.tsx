"use client"

import { useId, useState, useTransition } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AgentStatusAction, FeeImpact } from "@/lib/services/marketing-agents"

import { changeMarketingAgentStatus, readAgentFeeImpact } from "./actions"
import { actionEffect, actionVerb, familyLine, feeImpactLine, STATUS_LOST, STATUS_REASON_MAX } from "./outcome"

type Agent = { id: string; fullName: string; code: string }

function tzs(amount: number) {
  return `TZS ${amount.toLocaleString("en-US")}`
}

// Switch off or Switch on, and Retire, on an agent's row, for the Manager.
// Each opens a dialog that first lists the families whose interview fee the
// change moves, with a Swahili line to read to them, and asks for a reason.
export function AgentStatusActions({ agent, switchedOff }: { agent: Agent; switchedOff: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <StatusAction agent={agent} action={switchedOff ? "switch-on" : "switch-off"} />
      <StatusAction agent={agent} action="retire" />
    </div>
  )
}

type Impact = { status: "loading" } | { status: "ready"; impact: FeeImpact } | { status: "refused"; message: string }

function StatusAction({ agent, action }: { agent: Agent; action: AgentStatusAction }) {
  const [open, setOpen] = useState(false)
  const [impact, setImpact] = useState<Impact>({ status: "loading" })
  const [reason, setReason] = useState("")
  const [missing, setMissing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const reasonId = useId()
  const hintId = useId()
  const errorId = useId()
  const verb = actionVerb(action)

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    setMissing(false)
    setRefusal(null)
    if (!next) return
    // Read afresh each time, so the list is the one the change will meet.
    setImpact({ status: "loading" })
    readAgentFeeImpact(agent.id, action)
      .then(setImpact)
      .catch(() => setImpact({ status: "refused", message: "The families could not be listed just now. Try again in a moment." }))
  }

  function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim() === "") return setMissing(true)
    setRefusal(null)
    startTransition(async () => {
      let outcome
      try {
        outcome = await changeMarketingAgentStatus(agent.id, action, reason, { fullName: agent.fullName, code: agent.code })
      } catch {
        outcome = { status: "refused" as const, message: STATUS_LOST }
      }
      if (outcome.status === "refused") return setRefusal(outcome.message)
      setOpen(false)
      setReason("")
      toast.success(outcome.message)
    })
  }

  const families = impact.status === "ready" ? impact.impact.families : []

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={action === "switch-on" ? "default" : "outline"}
        onClick={() => changeOpen(true)}
        aria-label={`${verb} ${agent.fullName}`}
      >
        {verb}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        {/* Capped to the screen: on a short phone with many families the body
            scrolls between the title and the buttons, which stay in view. */}
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
          <form className="flex min-h-0 flex-col gap-4" onSubmit={confirm} noValidate>
            <DialogHeader>
              <DialogTitle>
                {verb} {agent.fullName}?
              </DialogTitle>
              <DialogDescription>{actionEffect(action, agent.code)}</DialogDescription>
            </DialogHeader>

            <div className="-mx-4 -my-1 grid min-h-0 gap-4 overflow-y-auto px-4 py-1">
              <section aria-label="Fee impact" className="grid gap-2" aria-busy={impact.status === "loading"}>
                {impact.status === "loading" && <p className="text-sm text-muted-foreground">Finding the families this changes…</p>}
                {impact.status === "refused" && (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{impact.message}</AlertDescription>
                  </Alert>
                )}
                {impact.status === "ready" && (
                  <>
                    <p className="text-sm font-semibold text-slate-900">{feeImpactLine(families.length)}</p>
                    {families.length > 0 && (
                      <>
                        <ul aria-label="Families not yet Paid" className="max-h-48 divide-y overflow-y-auto rounded-md text-sm ring-1 ring-foreground/10">
                          {families.map((family) => (
                            <li key={family.leadId} className="px-3 py-2">
                              <p className="font-medium text-slate-900">
                                {family.studentName} <span className="font-normal text-muted-foreground">· {family.admissionNumber} · {family.className}</span>
                              </p>
                              <p className="text-muted-foreground">
                                {family.contactName} · <a href={`tel:${family.contactPhone}`} className="underline-offset-4 hover:underline">{family.contactPhone}</a>{" "}
                                · {tzs(family.feeNow)} → {tzs(family.feeAfter)}
                              </p>
                            </li>
                          ))}
                        </ul>
                        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                          <p className="text-xs text-muted-foreground">Read this to each family:</p>
                          <p lang="sw" className="text-slate-900">
                            {familyLine(families[0])}
                          </p>
                        </div>
                      </>
                    )}
                  </>
                )}
              </section>

              <div className="grid gap-1.5">
                <Label htmlFor={reasonId}>Reason</Label>
                <Textarea
                  id={reasonId}
                  value={reason}
                  maxLength={STATUS_REASON_MAX}
                  onChange={(event) => {
                    setReason(event.target.value)
                    setMissing(false)
                  }}
                  aria-invalid={missing || undefined}
                  aria-describedby={missing ? `${hintId} ${errorId}` : hintId}
                />
                <p id={hintId} className="text-xs text-muted-foreground">
                  Required. Kept with the agent&apos;s history.
                </p>
              </div>
              {missing && (
                <p id={errorId} role="alert" className="text-sm text-destructive">
                  Write why you are making this change.
                </p>
              )}
              {refusal && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{refusal}</AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={action === "switch-on" ? "default" : "destructive"}
                disabled={pending || impact.status !== "ready"}
              >
                {pending ? "Saving…" : `${verb} ${agent.code}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
