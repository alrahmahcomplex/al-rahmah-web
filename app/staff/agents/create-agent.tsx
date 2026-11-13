"use client"

import Link from "next/link"
import { useCallback, useId, useRef, useState, useTransition, type ReactNode } from "react"

import { Button, KeyValueList, Note, Sheet } from "@/components/kit"
import type { AgentCheck, AgentConflict } from "@/lib/services/marketing-agents"

import { checkNewMarketingAgent, createMarketingAgent, type AgentDraftInput } from "./actions"
import { AgentFields } from "./agent-fields"
import { AGENT_LOST, agentRecordHref, codeTakenLine, phoneTakenLine, retiredCodeLine, type DraftRefusal } from "./outcome"
import { useRecreateForm, type RecreateParts } from "./recreate-agent"
import { toast } from "./form-parts"
import "./agents.css"

const EMPTY: AgentDraftInput = { fullName: "", phone: "", whatsapp: "", email: "", code: "" }

type Step =
  | { name: "form" }
  // `checked` is the input the check ran on, exactly what Create agent saves.
  | { name: "check"; check: Extract<AgentCheck, { kind: "ready" }>; checked: AgentDraftInput }
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
  // Bumped on every edit, so a check answering after the details changed is
  // dropped instead of confirming values the form no longer holds.
  const edits = useRef(0)

  function edit(next: AgentDraftInput) {
    edits.current += 1
    setDraft(next)
  }

  function changeOpen(next: boolean) {
    if (busy) return
    setOpen(next)
    if (next) {
      edit(EMPTY)
      setStep({ name: "form" })
      setRefusal(null)
    }
  }

  const close = useCallback(() => setOpen(false), [])
  const backToForm = useCallback(() => setStep({ name: "form" }), [])
  const formId = useId()
  const recreate = useRecreateForm({
    active: open && step.name === "recreate",
    agentId: step.name === "recreate" ? step.agentId : "",
    code: step.name === "recreate" ? step.code : "",
    initial: draft,
    onBusy: setRecreating,
    onDone: close,
    onBack: backToForm,
  })

  function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRefusal(null)
    const checked = draft
    const version = edits.current
    startTransition(async () => {
      let answer
      try {
        answer = await checkNewMarketingAgent(checked)
      } catch {
        answer = { status: "refused" as const, message: "The agent could not be checked just now. Nothing was saved. Try again in a moment." }
      }
      if (edits.current !== version) return
      if (answer.status === "refused") return setRefusal(answer)
      setStep(answer.status === "ready" ? { name: "check", check: answer.check, checked } : { name: "conflict", conflict: answer.conflict })
    })
  }

  function create(checked: AgentDraftInput) {
    setRefusal(null)
    startTransition(async () => {
      let answer
      try {
        answer = await createMarketingAgent(checked)
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
      toast(answer.message)
      setOpen(false)
    })
  }

  const parts: RecreateParts =
    step.name === "recreate"
      ? recreate
      : step.name === "form"
        ? {
            title: "Add agent",
            hint: "The agent starts Approved. You check the details before they are saved.",
            body: (
              <form id={formId} className="ag-stack" onSubmit={check} noValidate>
                <AgentFields fields={["full_name", "phone", "whatsapp", "email", "code"]} value={draft} onChange={edit} refused={refusal} disabled={busy} />
                {refusal && !refusal.field && (
                  <Note tone="bad" role="alert">
                    {refusal.message}
                  </Note>
                )}
              </form>
            ),
            foot: (
              <>
                <Button type="submit" form={formId} size="wide" disabled={busy || draft.fullName.trim() === "" || draft.phone.trim() === ""}>
                  {pending ? "Checking…" : "Check details"}
                </Button>
                <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} disabled={busy}>
                  Cancel
                </Button>
              </>
            ),
          }
        : step.name === "check"
          ? {
              title: "Check before saving",
              hint: "This is how the agent will be saved.",
              body: (
                <>
                  <div role="group" aria-label="Agent to save">
                    <KeyValueList
                      items={[
                        { key: "Full name", value: step.check.fullName },
                        { key: "Mobile", value: displayPhone(step.check.phone) },
                        { key: "WhatsApp", value: step.check.whatsapp ? displayPhone(step.check.whatsapp) : "Same as mobile" },
                        { key: "Email", value: step.check.email ?? "None" },
                        {
                          key: "Code",
                          value: step.check.code ? (
                            <span className="ag-mono">{step.check.code}</span>
                          ) : (
                            <>New, made on saving: {step.check.codePrefix}- and digits</>
                          ),
                        },
                      ]}
                    />
                  </div>
                  {refusal && (
                    <Note tone="bad" role="alert">
                      {refusal.message}
                    </Note>
                  )}
                </>
              ),
              foot: (
                <>
                  <Button size="wide" onClick={() => create(step.checked)} disabled={busy}>
                    {pending ? "Saving…" : "Create agent"}
                  </Button>
                  <Button variant="ghost" size="wide" onClick={() => setStep({ name: "form" })} disabled={busy}>
                    Edit
                  </Button>
                </>
              ),
            }
          : conflictParts(step.conflict, {
              onOpenRecord: close,
              onBack: () => setStep({ name: "form" }),
              onRecreate: (agentId, code) => setStep({ name: "recreate", agentId, code }),
            })

  return (
    <>
      <Button onClick={() => changeOpen(true)}>Add agent</Button>
      <Sheet open={open} onOpenChange={changeOpen} title={parts.title} hint={parts.hint} closeLabel="Close" foot={parts.foot}>
        {parts.body}
      </Sheet>
    </>
  )
}

// Why nothing was saved: the phone or code belongs to someone, with a link to
// their record, or the code was a retired record's, with Recreate.
function conflictParts(
  conflict: AgentConflict,
  {
    onOpenRecord,
    onBack,
    onRecreate,
  }: {
    onOpenRecord: () => void
    onBack: () => void
    onRecreate: (agentId: string, code: string) => void
  },
): RecreateParts {
  const retired = conflict.kind === "retired-code"
  const line =
    conflict.kind === "phone-taken"
      ? phoneTakenLine(conflict.agent)
      : conflict.kind === "code-taken"
        ? codeTakenLine(conflict.agent)
        : retiredCodeLine(conflict.agent, conflict.studentCount)
  const body: ReactNode = (
    <Note tone={retired ? "info" : "bad"} role="alert">
      <span className="ag-stack">
        <span>{line}</span>
        <Link href={agentRecordHref(conflict.agent.code, retired)} onClick={onOpenRecord} className="ag-link">
          Open {conflict.agent.fullName}&apos;s record
        </Link>
      </span>
    </Note>
  )
  return {
    title: retired ? "Recreate this code?" : "Nothing was saved",
    hint: retired
      ? "A retired record's code comes back only through Recreate, for the same person."
      : "Each phone and each code belongs to one current agent.",
    body,
    foot: (
      <>
        {retired && (
          <Button size="wide" onClick={() => onRecreate(conflict.agent.id, conflict.agent.code)}>
            Recreate
          </Button>
        )}
        <Button variant="ghost" size="wide" onClick={onBack}>
          Edit
        </Button>
      </>
    ),
  }
}
