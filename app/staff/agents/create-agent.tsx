"use client"

import Link from "next/link"
import { useCallback, useState, useTransition } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { AgentCheck, AgentConflict } from "@/lib/services/marketing-agents"

import { checkNewMarketingAgent, createMarketingAgent, type AgentDraftInput } from "./actions"
import { AgentFields } from "./agent-fields"
import { AGENT_LOST, agentRecordHref, codeTakenLine, phoneTakenLine, retiredCodeLine, type DraftRefusal } from "./outcome"
import { RecreateForm } from "./recreate-agent"

const EMPTY: AgentDraftInput = { fullName: "", phone: "", whatsapp: "", email: "", code: "" }

type Step =
  | { name: "form" }
  | { name: "check"; check: Extract<AgentCheck, { kind: "ready" }> }
  | { name: "conflict"; conflict: AgentConflict }
  | { name: "recreate"; agentId: string; code: string }

// A phone stored as +255700000401 shown as +255 700 000 401.
function displayPhone(phone: string) {
  const match = /^\+255(\d{3})(\d{3})(\d{3})$/.exec(phone)
  return match ? `+255 ${match[1]} ${match[2]} ${match[3]}` : phone
}

// Add agent, for the Manager: type the details, check them as they will be
// saved, then create the agent, Approved. A phone or code already in use
// says whose it is; a retired record's code offers Recreate.
export function CreateAgent() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AgentDraftInput>(EMPTY)
  const [step, setStep] = useState<Step>({ name: "form" })
  const [refusal, setRefusal] = useState<DraftRefusal | null>(null)
  const [pending, startTransition] = useTransition()
  const [recreating, setRecreating] = useState(false)
  const busy = pending || recreating

  function changeOpen(next: boolean) {
    if (busy) return
    setOpen(next)
    if (next) {
      setDraft(EMPTY)
      setStep({ name: "form" })
      setRefusal(null)
    }
  }

  const close = useCallback(() => setOpen(false), [])

  function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRefusal(null)
    startTransition(async () => {
      let answer
      try {
        answer = await checkNewMarketingAgent(draft)
      } catch {
        answer = { status: "refused" as const, message: "The agent could not be checked just now. Nothing was saved. Try again in a moment." }
      }
      if (answer.status === "refused") return setRefusal(answer)
      setStep(answer.status === "ready" ? { name: "check", check: answer.check } : { name: "conflict", conflict: answer.conflict })
    })
  }

  function create() {
    setRefusal(null)
    startTransition(async () => {
      let answer
      try {
        answer = await createMarketingAgent(draft)
      } catch {
        answer = { status: "refused" as const, message: AGENT_LOST }
      }
      if (answer.status === "refused") {
        setRefusal(answer)
        // A field to correct goes back to the form.
        if (answer.field) setStep({ name: "form" })
        return
      }
      if (answer.status === "conflict") return setStep({ name: "conflict", conflict: answer.conflict })
      toast.success(answer.message)
      setOpen(false)
    })
  }

  return (
    <>
      <Button type="button" onClick={() => changeOpen(true)}>
        Add agent
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
          {step.name === "recreate" ? (
            <RecreateForm
              agentId={step.agentId}
              code={step.code}
              initial={draft}
              onBusy={setRecreating}
              onDone={close}
              onBack={() => setStep({ name: "form" })}
            />
          ) : step.name === "form" ? (
            <form className="flex min-h-0 flex-col gap-4" onSubmit={check} noValidate>
              <DialogHeader>
                <DialogTitle>Add agent</DialogTitle>
                <DialogDescription>The agent starts Approved. You check the details before they are saved.</DialogDescription>
              </DialogHeader>
              <div className="-mx-4 -my-1 grid min-h-0 gap-4 overflow-y-auto px-4 py-1">
                <AgentFields fields={["full_name", "phone", "whatsapp", "email", "code"]} value={draft} onChange={setDraft} refused={refusal} />
                {refusal && !refusal.field && (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{refusal.message}</AlertDescription>
                  </Alert>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || draft.fullName.trim() === "" || draft.phone.trim() === ""}>
                  {pending ? "Checking…" : "Check details"}
                </Button>
              </DialogFooter>
            </form>
          ) : step.name === "check" ? (
            <div className="flex min-h-0 flex-col gap-4">
              <DialogHeader>
                <DialogTitle>Check before saving</DialogTitle>
                <DialogDescription>This is how the agent will be saved.</DialogDescription>
              </DialogHeader>
              <div className="-mx-4 -my-1 grid min-h-0 gap-4 overflow-y-auto px-4 py-1">
                <dl aria-label="Agent to save" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Full name</dt>
                  <dd className="text-slate-900">{step.check.fullName}</dd>
                  <dt className="text-muted-foreground">Mobile</dt>
                  <dd className="text-slate-900">{displayPhone(step.check.phone)}</dd>
                  <dt className="text-muted-foreground">WhatsApp</dt>
                  <dd className="text-slate-900">{step.check.whatsapp ? displayPhone(step.check.whatsapp) : "Same as mobile"}</dd>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="break-all text-slate-900">{step.check.email ?? "None"}</dd>
                  <dt className="text-muted-foreground">Code</dt>
                  <dd className="font-mono text-slate-900">
                    {step.check.code ?? <span className="font-sans">New, made on saving: {step.check.codePrefix}- and digits</span>}
                  </dd>
                </dl>
                {refusal && (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{refusal.message}</AlertDescription>
                  </Alert>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStep({ name: "form" })} disabled={busy}>
                  Edit
                </Button>
                <Button type="button" onClick={create} disabled={busy}>
                  {pending ? "Saving…" : "Create agent"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <Conflict
              conflict={step.conflict}
              onOpenRecord={close}
              onBack={() => setStep({ name: "form" })}
              onRecreate={(agentId, code) => setStep({ name: "recreate", agentId, code })}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

// Why nothing was saved: the phone or code belongs to someone, with a link to
// their record, or the code was a retired record's, with Recreate.
function Conflict({
  conflict,
  onOpenRecord,
  onBack,
  onRecreate,
}: {
  conflict: AgentConflict
  onOpenRecord: () => void
  onBack: () => void
  onRecreate: (agentId: string, code: string) => void
}) {
  const retired = conflict.kind === "retired-code"
  const line =
    conflict.kind === "phone-taken"
      ? phoneTakenLine(conflict.agent)
      : conflict.kind === "code-taken"
        ? codeTakenLine(conflict.agent)
        : retiredCodeLine(conflict.agent, conflict.studentCount)
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{retired ? "Recreate this code?" : "Nothing was saved"}</DialogTitle>
        <DialogDescription>
          {retired
            ? "A retired record's code comes back only through Recreate, for the same person."
            : "Each phone and each code belongs to one current agent."}
        </DialogDescription>
      </DialogHeader>
      <Alert role="alert" variant={retired ? "default" : "destructive"}>
        <AlertDescription>
          <p>{line}</p>
          <Link href={agentRecordHref(conflict.agent.code, retired)} onClick={onOpenRecord} className="font-medium underline underline-offset-4">
            Open {conflict.agent.fullName}&apos;s record
          </Link>
        </AlertDescription>
      </Alert>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          Edit
        </Button>
        {retired && (
          <Button type="button" onClick={() => onRecreate(conflict.agent.id, conflict.agent.code)}>
            Recreate
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}
