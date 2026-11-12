"use client"

import { useId, useOptimistic, useState, useTransition } from "react"
import { Button, Note as KitNote, Section, Sheet } from "@/components/kit"

import { readAgentDiscountImpact, saveAgentDiscount } from "./discount-actions"
import { DiscountChip, DiscountImpact, DiscountKindChoice, Facts, LockedNote, MoneyField, Note, ReasonField, useImpact, type ChipTone } from "./discount-fields"
import {
  AGENT_REASON_MISSING,
  AMOUNT_HINT,
  DISCOUNT_LOST,
  feeBecomes,
  INTERVIEW_FEE,
  LOCKED_NOTE,
  parseAmount,
  plural,
  tzs,
  type DiscountOutcome,
} from "./discount-outcome"
import { toast } from "./form-parts"

export type DiscountAgent = {
  id: string
  fullName: string
  code: string
  // The phone as shown, such as +255 712 000 401.
  phone: string
  status: { label: string; tone: ChipTone }
  studentCount: number
  // Null: on the standard.
  interviewDiscount: number | null
  retired: boolean
}

// The Interview discount cell on an agent's row: the amount the code gives
// and whether it is the standard or the agent's own, as a quiet button that
// opens the agent's discount sheet. A save shows in the cell at once and
// goes back if the database refuses it, with the reason in the sheet.
export function AgentDiscount({ agent, standard, canManage }: { agent: DiscountAgent; standard: number; canManage: boolean }) {
  const [open, setOpen] = useState(false)
  // Each opening starts from the agent as the row shows them.
  const [opening, setOpening] = useState(0)
  const [own, setOwn] = useOptimistic(agent.interviewDiscount)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const amount = own ?? standard

  function changeOpen(next: boolean) {
    if (pending) return
    if (next) {
      setOpening((count) => count + 1)
      setRefusal(null)
    }
    setOpen(next)
  }

  function save(next: number | null, reason: string) {
    setRefusal(null)
    startTransition(async () => {
      setOwn(next)
      let outcome: DiscountOutcome
      try {
        outcome = await saveAgentDiscount(agent.id, next, reason, { code: agent.code, standard })
      } catch {
        outcome = { status: "refused", message: DISCOUNT_LOST }
      }
      if (outcome.status === "refused") return setRefusal(outcome.message)
      setOpen(false)
      toast(outcome.message)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => changeOpen(true)}
        aria-label={`Interview discount for ${agent.fullName}: ${tzs(amount)}, ${own === null ? "standard" : "own amount"}`}
        className="ag-cellbtn"
      >
        <span className="ag-strong ag-num">{tzs(amount)}</span> <span className="ag-quiet">{own === null ? "standard" : "own amount"}</span>
      </button>
      <AgentDiscountSheet
        key={opening}
        open={open}
        onOpenChange={changeOpen}
        agent={agent}
        own={own}
        standard={standard}
        editable={canManage && !agent.retired}
        canManage={canManage}
        pending={pending}
        refusal={refusal}
        onSave={save}
      />
    </>
  )
}

function AgentDiscountSheet({
  open,
  onOpenChange,
  agent,
  own,
  standard,
  editable,
  canManage,
  pending,
  refusal,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: DiscountAgent
  own: number | null
  standard: number
  editable: boolean
  canManage: boolean
  pending: boolean
  refusal: string | null
  onSave: (amount: number | null, reason: string) => void
}) {
  const ids = useId()
  const [kind, setKind] = useState<"standard" | "own">(own === null ? "standard" : "own")
  const [typed, setTyped] = useState(String(own ?? standard))
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({})
  const typedAmount = parseAmount(typed)
  const changed = kind === "own" ? typedAmount === null || typedAmount !== own : own !== null
  // What the code would take off, when the typed amount reads.
  const next = kind === "standard" ? null : typedAmount
  const askable = editable && changed && (kind === "standard" || typedAmount !== null)
  const impact = useImpact(askable ? `${kind}:${next}` : null, () => readAgentDiscountImpact(agent.id, next))

  const meta = (
    <span className="ag-row ag-quiet">
      <span className="ag-mono">{agent.code}</span>
      <DiscountChip tone={agent.status.tone}>{agent.status.label}</DiscountChip>
      <span>{plural(agent.studentCount, "student")}</span>
    </span>
  )

  if (!editable) {
    const amount = own ?? standard
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        placement="side"
        title={agent.fullName}
        chips={meta}
        closeLabel="Close"
        foot={
          <Button variant="ghost" size="wide" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        }
      >
        <Section title="Interview discount">
          <Facts
            rows={[
              ["Gives", `${tzs(amount)} off ${own === null ? "(standard)" : "(own amount)"}`],
              ["Fee becomes", tzs(INTERVIEW_FEE - amount)],
              ["Mobile", agent.phone],
            ]}
          />
        </Section>
        {canManage ? <Note>This agent is retired, so nothing about them can change.</Note> : <LockedNote>{LOCKED_NOTE}</LockedNote>}
      </Sheet>
    )
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !changed) return
    const found = {
      amount: kind === "own" && typedAmount === null ? AMOUNT_HINT : undefined,
      reason: reason.trim() === "" ? AGENT_REASON_MISSING : undefined,
    }
    setErrors(found)
    if (found.amount || found.reason) return
    onSave(next, reason)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      placement="side"
      title={agent.fullName}
      chips={meta}
      closeLabel="Close"
      foot={
        <>
          <Button type="submit" form={`${ids}-form`} size="wide" pending={pending} disabled={!changed}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" size="wide" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={submit} noValidate className="ag-stack">
        <DiscountKindChoice
          name={`${ids}-kind`}
          legend={<span className="ag-label">Interview discount</span>}
          value={kind}
          onChange={(value) => setKind(value === "own" ? "own" : "standard")}
          options={[
            { value: "standard", title: `Standard, ${tzs(standard)} off`, line: "Follows the standard amount when it changes." },
            { value: "own", title: "Own amount", line: "Set for this agent only." },
          ]}
        >
          {kind === "own" && (
            <MoneyField
              id={`${ids}-amount`}
              label="Amount off the TZS 50,000 fee"
              value={typed}
              onChange={(value) => {
                setTyped(value)
                setErrors((current) => ({ ...current, amount: undefined }))
              }}
              help={changed && typedAmount !== null ? feeBecomes(typedAmount) : null}
              error={errors.amount}
            />
          )}
        </DiscountKindChoice>
        {changed && (
          <div className="ag-stack">
            <ReasonField
              id={`${ids}-reason`}
              value={reason}
              onChange={(value) => {
                setReason(value)
                setErrors((current) => ({ ...current, reason: undefined }))
              }}
              placeholder="e.g. Head teacher, agreed with the Director"
              error={errors.reason}
            />
            <DiscountImpact impact={impact} />
          </div>
        )}
        {refusal && (
          <KitNote tone="bad" role="alert">
            {refusal}
          </KitNote>
        )}
      </form>
    </Sheet>
  )
}
