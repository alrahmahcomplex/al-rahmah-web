"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { RecreatePreview } from "@/lib/services/marketing-agents"

import { readRecreatePreview, recreateMarketingAgent, type AgentDraftInput } from "./actions"
import { AgentFields } from "./agent-fields"
import { FeeImpact } from "./fee-impact"
import { samePersonLabel, STATUS_REASON_MAX, type DraftRefusal } from "./outcome"

type Preview = { status: "loading" } | { status: "ready"; preview: RecreatePreview } | { status: "refused"; message: string }

const EMPTY: AgentDraftInput = { fullName: "", phone: "", whatsapp: "", email: "", code: "" }

// The Recreate button on a current agent's row: retire the record and create
// the corrected one with the same code, in one step.
export function RecreateAgent({ agent }: { agent: { id: string; fullName: string; code: string } }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`Recreate ${agent.fullName}`}>
        Recreate
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
          {open && <RecreateForm agentId={agent.id} code={agent.code} onBusy={setBusy} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

// The Recreate step, inside a dialog: the record's details to correct, how
// many students carry the code, the families whose fee moves, the
// same-person tick and the reason. `initial` fills the details, as typed in
// Add agent; otherwise they start as the record has them.
export function RecreateForm({
  agentId,
  code,
  initial,
  onBusy,
  onDone,
  onBack,
}: {
  agentId: string
  code: string
  initial?: AgentDraftInput
  onBusy: (busy: boolean) => void
  onDone: () => void
  onBack?: () => void
}) {
  const [preview, setPreview] = useState<Preview>({ status: "loading" })
  const [draft, setDraft] = useState<AgentDraftInput>(initial ?? EMPTY)
  const [same, setSame] = useState(false)
  const [reason, setReason] = useState("")
  const [refusal, setRefusal] = useState<DraftRefusal | null>(null)
  const [pending, startTransition] = useTransition()
  const reasonId = useId()
  const sameId = useId()

  useEffect(() => {
    let current = true
    readRecreatePreview(agentId)
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
  }, [agentId, initial])

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
      toast.success(answer.message)
      onDone()
    })
  }

  const ready = preview.status === "ready" ? preview.preview : null
  const studentCount = ready?.studentCount ?? 0

  return (
    <form className="flex min-h-0 flex-col gap-4" onSubmit={confirm} noValidate>
      <DialogHeader>
        <DialogTitle>Recreate {ready?.agent.fullName ?? code}?</DialogTitle>
        <DialogDescription>
          {ready?.agent.retired
            ? `Creates a corrected record holding ${code}, Approved and switched on. The retired record stays for history.`
            : `Retires this record and creates a corrected one holding ${code}, Approved and switched on, in one step. The retired record stays for history.`}
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-4 -my-1 grid min-h-0 gap-4 overflow-y-auto px-4 py-1">
        {preview.status === "loading" && <p className="text-sm text-muted-foreground">Reading the record…</p>}
        {preview.status === "refused" && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{preview.message}</AlertDescription>
          </Alert>
        )}
        {ready && (
          <>
            <AgentFields
              fields={["full_name", "phone", "whatsapp", "email"]}
              value={draft}
              onChange={setDraft}
              refused={refusal}
              disabled={pending}
            />
            <FeeImpact impact={{ status: "ready", families: ready.families }} />
            <div className="flex items-start gap-2 text-sm">
              <Checkbox
                id={sameId}
                className="mt-0.5"
                checked={same}
                disabled={pending}
                onCheckedChange={(checked) => setSame(checked === true)}
              />
              <Label htmlFor={sameId} className="font-normal text-slate-900">
                {samePersonLabel(code, studentCount)}
              </Label>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={reasonId}>Reason</Label>
              <Textarea
                id={reasonId}
                value={reason}
                maxLength={STATUS_REASON_MAX}
                disabled={pending}
                onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
                onChange={(event) => setReason(event.target.value)}
                aria-describedby={`${reasonId}-hint`}
              />
              <p id={`${reasonId}-hint`} className="text-xs text-muted-foreground">
                Required. Kept with the agent&apos;s history.
              </p>
            </div>
          </>
        )}
        {refusal && !refusal.field && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{refusal.message}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack ?? onDone} disabled={pending}>
          {onBack ? "Back" : "Cancel"}
        </Button>
        <Button type="submit" variant="destructive" disabled={pending || !ready || !same || reason.trim() === ""}>
          {pending ? "Saving…" : `Recreate ${code}`}
        </Button>
      </DialogFooter>
    </form>
  )
}
