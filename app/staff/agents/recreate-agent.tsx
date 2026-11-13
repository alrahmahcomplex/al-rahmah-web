"use client"

import { useCallback, useEffect, useId, useState, useTransition, type ReactNode } from "react"

import { Button, Note, Sheet } from "@/components/kit"
import type { RecreatePreview } from "@/lib/services/marketing-agents"

import { readRecreatePreview, recreateMarketingAgent, type AgentDraftInput } from "./actions"
import { AgentFields } from "./agent-fields"
import { FeeImpact } from "./fee-impact"
import { Checkbox, TextArea, toast } from "./form-parts"
import { samePersonLabel, STATUS_REASON_MAX, type DraftRefusal } from "./outcome"
import "./agents.css"

type Preview = { status: "loading" } | { status: "ready"; preview: RecreatePreview } | { status: "refused"; message: string }

const EMPTY: AgentDraftInput = { fullName: "", phone: "", whatsapp: "", email: "", code: "" }

// The Recreate button on a current agent's row: retire the record and create
// the corrected one with the same code, in one step.
export function RecreateAgent({ agent }: { agent: { id: string; fullName: string; code: string } }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const parts = useRecreateForm({ active: open, agentId: agent.id, code: agent.code, onBusy: setBusy, onDone: close })
  return (
    <>
      <Button size="small" variant="ghost" onClick={() => setOpen(true)} aria-label={`Recreate ${agent.fullName}`}>
        Recreate
      </Button>
      <Sheet open={open} onOpenChange={(next) => !busy && setOpen(next)} title={parts.title} hint={parts.hint} closeLabel="Close" foot={parts.foot}>
        {parts.body}
      </Sheet>
    </>
  )
}

export type RecreateParts = { title: ReactNode; hint: ReactNode; body: ReactNode; foot: ReactNode }

// The Recreate step, as the parts of the sheet that shows it: the record's
// details to correct, how many students carry the code, the families whose
// fee moves, the same-person tick and the reason. `initial` fills the
// details, as typed in Add agent; otherwise they start as the record has
// them. Each time `active` turns on, the step starts afresh.
export function useRecreateForm({
  active,
  agentId,
  code,
  initial,
  onBusy,
  onDone,
  onBack,
}: {
  active: boolean
  agentId: string
  code: string
  initial?: AgentDraftInput
  onBusy: (busy: boolean) => void
  onDone: () => void
  onBack?: () => void
}): RecreateParts {
  const [preview, setPreview] = useState<Preview>({ status: "loading" })
  const [draft, setDraft] = useState<AgentDraftInput>(initial ?? EMPTY)
  const [same, setSame] = useState(false)
  const [reason, setReason] = useState("")
  const [refusal, setRefusal] = useState<DraftRefusal | null>(null)
  const [pending, startTransition] = useTransition()
  const formId = useId()
  const reasonId = useId()
  const sameId = useId()

  // A fresh start each time the step opens, for this record.
  const session = active ? agentId : null
  const [started, setStarted] = useState<string | null>(null)
  if (started !== session) {
    setStarted(session)
    if (session !== null) {
      setPreview({ status: "loading" })
      setDraft(initial ?? EMPTY)
      setSame(false)
      setReason("")
      setRefusal(null)
    }
  }

  useEffect(() => {
    if (session === null) return
    let current = true
    readRecreatePreview(session)
      .then((answer) => {
        if (!current) return
        setPreview(answer)
        if (answer.status === "ready" && !initial) {
          const agent = answer.preview.agent
          setDraft({ fullName: agent.fullName, phone: agent.phone, whatsapp: agent.whatsapp ?? "", email: agent.email ?? "", code: agent.code })
        }
      })
      .catch(() => current && setPreview({ status: "refused", message: "The record could not be read just now. Try again in a moment." }))
    return () => {
      current = false
    }
  }, [session, initial])

  useEffect(() => onBusy(pending), [pending, onBusy])

  function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!same || reason.trim() === "") return
    setRefusal(null)
    startTransition(async () => {
      let answer
      try {
        answer = await recreateMarketingAgent(agentId, draft, reason)
      } catch {
        answer = {
          status: "refused" as const,
          message: "The Recreate could not be confirmed. Check your connection, reload the page and see whether the agent was recreated.",
        }
      }
      if (answer.status === "refused") return setRefusal(answer)
      toast(answer.message)
      onDone()
    })
  }

  const ready = preview.status === "ready" ? preview.preview : null
  const studentCount = ready?.studentCount ?? 0

  return {
    title: `Recreate ${ready?.agent.fullName ?? code}?`,
    hint: ready?.agent.retired
      ? `Creates a corrected record holding ${code}, Approved and switched on. The retired record stays for history.`
      : `Retires this record and creates a corrected one holding ${code}, Approved and switched on, in one step. The retired record stays for history.`,
    body: (
      <form id={formId} className="ag-stack" onSubmit={confirm} noValidate>
        {preview.status === "loading" && <p className="ag-p ag-quiet">Reading the record…</p>}
        {preview.status === "refused" && (
          <Note tone="bad" role="alert">
            {preview.message}
          </Note>
        )}
        {ready && (
          <>
            <AgentFields fields={["full_name", "phone", "whatsapp", "email"]} value={draft} onChange={setDraft} refused={refusal} disabled={pending} />
            <FeeImpact impact={{ status: "ready", families: ready.families }} />
            <Checkbox id={sameId} checked={same} disabled={pending} onCheckedChange={setSame} label={samePersonLabel(code, studentCount)} />
            <div className="ag-field">
              <label htmlFor={reasonId} className="ag-label">
                Reason
              </label>
              <TextArea
                id={reasonId}
                value={reason}
                maxLength={STATUS_REASON_MAX}
                disabled={pending}
                onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
                onChange={(event) => setReason(event.target.value)}
                aria-describedby={`${reasonId}-hint`}
              />
              <p id={`${reasonId}-hint`} className="ag-hint">
                Required. Kept with the agent&apos;s history.
              </p>
            </div>
          </>
        )}
        {refusal && !refusal.field && (
          <Note tone="bad" role="alert">
            {refusal.message}
          </Note>
        )}
      </form>
    ),
    foot: (
      <>
        <Button type="submit" form={formId} size="wide" disabled={pending || !ready || !same || reason.trim() === ""}>
          {pending ? "Saving…" : `Recreate ${code}`}
        </Button>
        <Button variant="ghost" size="wide" onClick={onBack ?? onDone} disabled={pending}>
          {onBack ? "Back" : "Cancel"}
        </Button>
      </>
    ),
  }
}
