"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"

import { Button, Note, Sheet } from "@/components/kit"
import type { AgentStatusAction, FeeImpact as FeeImpactList } from "@/lib/services/marketing-agents"

import { changeMarketingAgentStatus, readAgentFeeImpact } from "./actions"
import { FeeImpact } from "./fee-impact"
import { TextArea, toast } from "./form-parts"
import "./agents.css"
import { actionEffect, actionVerb, STATUS_LOST, STATUS_REASON_MAX } from "./outcome"

type Agent = { id: string; fullName: string; code: string }

// Switch off or Switch on, and Retire, on an agent's row, for the Manager.
// Each opens a dialog that first lists the families whose interview fee the
// change moves, with a Swahili line to read to them, and asks for a reason.
export function AgentStatusActions({ agent, switchedOff }: { agent: Agent; switchedOff: boolean }) {
  return (
    <div className="ag-row">
      <StatusAction agent={agent} action={switchedOff ? "switch-on" : "switch-off"} />
      <StatusAction agent={agent} action="retire" />
    </div>
  )
}

type Impact = { status: "loading" } | { status: "ready"; impact: FeeImpactList } | { status: "refused"; message: string }

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
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const verb = actionVerb(action)

  // The dialog focuses the reason on open, while the families are still loading.
  // When the list arrives above it, the focused field is pushed below the
  // scrolling body's edge, so bring it back into view.
  useEffect(() => {
    const field = reasonRef.current
    if (impact.status !== "loading" && field && field === document.activeElement) {
      field.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
  }, [impact.status])

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
      toast(outcome.message)
    })
  }

  return (
    <>
      <Button size="small" variant="ghost" onClick={() => changeOpen(true)} aria-label={`${verb} ${agent.fullName}`}>
        {verb}
      </Button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`${verb} ${agent.fullName}?`}
        hint={actionEffect(action, agent.code)}
        closeLabel="Close"
        foot={
          <>
            <Button
              type="submit"
              form={`${reasonId}-form`}
              size="wide"
              disabled={pending || impact.status !== "ready" || reason.trim() === ""}
            >
              {pending ? "Saving…" : `${verb} ${agent.code}`}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </>
        }
      >
        <form id={`${reasonId}-form`} className="ag-stack" onSubmit={confirm} noValidate>
          <FeeImpact impact={impact.status === "ready" ? { status: "ready", families: impact.impact.families } : impact} />

          <div className="ag-field">
            <label htmlFor={reasonId} className="ag-label">
              Reason
            </label>
            <TextArea
              ref={reasonRef}
              id={reasonId}
              value={reason}
              maxLength={STATUS_REASON_MAX}
              // Tab can land on the field while it sits below the scrolling body's edge.
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
              onChange={(event) => {
                setReason(event.target.value)
                setMissing(false)
              }}
              aria-invalid={missing || undefined}
              aria-describedby={missing ? `${hintId} ${errorId}` : hintId}
            />
            <p id={hintId} className="ag-hint">
              Required. Kept with the agent&apos;s history.
            </p>
          </div>
          {missing && (
            <p id={errorId} role="alert" className="ag-error">
              Write why you are making this change.
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
