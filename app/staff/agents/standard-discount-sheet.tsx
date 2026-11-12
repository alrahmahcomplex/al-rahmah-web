"use client"

import { useId, useState, useTransition } from "react"
import { Button, Card, Note, Sheet, TextLink } from "@/components/kit"

import { readStandardDiscountImpact, saveStandardDiscount } from "./discount-actions"
import { DiscountImpact, MoneyField, ReasonField, useImpact } from "./discount-fields"
import {
  AMOUNT_HINT,
  DISCOUNT_LOST,
  parseAmount,
  REASON_MISSING,
  standardHelp,
  standardLine,
  tzs,
  type DiscountOutcome,
} from "./discount-outcome"
import "./agents.css"
import { toast } from "./form-parts"

// The setting line above the Agents table: what every agent's code gives
// unless the agent has an own amount, and how many Approved agents are on
// it. Change, for roles that set discount amounts, opens the sheet.
export function StandardDiscount({
  amount,
  agentsOnStandard,
  canManage,
}: {
  amount: number
  agentsOnStandard: number
  canManage: boolean
}) {
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(0)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function changeOpen(next: boolean) {
    if (pending) return
    if (next) {
      setOpening((count) => count + 1)
      setRefusal(null)
    }
    setOpen(next)
  }

  function save(next: number, reason: string) {
    setRefusal(null)
    startTransition(async () => {
      let outcome: DiscountOutcome
      try {
        outcome = await saveStandardDiscount(next, reason)
      } catch {
        outcome = { status: "refused", message: DISCOUNT_LOST }
      }
      if (outcome.status === "refused") return setRefusal(outcome.message)
      setOpen(false)
      toast(outcome.message)
    })
  }

  return (
    <Card className="ag-standard">
      <p>
        <span className="ag-quiet">Standard discount</span>
        &nbsp; <span className="ag-strong ag-num">{tzs(amount)} off</span>{" "}
        <span className="ag-small ag-quiet">{standardLine(agentsOnStandard)}</span>
      </p>
      {canManage && (
        <>
          <TextLink onClick={() => changeOpen(true)} aria-label="Change the standard discount">
            Change
          </TextLink>
          <StandardSheet
            key={opening}
            open={open}
            onOpenChange={changeOpen}
            amount={amount}
            agentsOnStandard={agentsOnStandard}
            pending={pending}
            refusal={refusal}
            onSave={save}
          />
        </>
      )}
    </Card>
  )
}

function StandardSheet({
  open,
  onOpenChange,
  amount,
  agentsOnStandard,
  pending,
  refusal,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  amount: number
  agentsOnStandard: number
  pending: boolean
  refusal: string | null
  onSave: (amount: number, reason: string) => void
}) {
  const ids = useId()
  const [typed, setTyped] = useState(String(amount))
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({})
  const typedAmount = parseAmount(typed)
  const changed = typedAmount !== amount
  const impact = useImpact(changed && typedAmount !== null ? String(typedAmount) : null, () =>
    readStandardDiscountImpact(typedAmount ?? amount),
  )

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !changed) return
    const found = {
      amount: typedAmount === null ? AMOUNT_HINT : undefined,
      reason: reason.trim() === "" ? REASON_MISSING : undefined,
    }
    setErrors(found)
    if (found.amount || found.reason || typedAmount === null) return
    onSave(typedAmount, reason)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      placement="side"
      title="Standard discount"
      hint="What every agent's code gives unless the agent has an own amount."
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
        <MoneyField
          id={`${ids}-amount`}
          label="Amount off the TZS 50,000 interview fee"
          value={typed}
          onChange={(value) => {
            setTyped(value)
            setErrors((current) => ({ ...current, amount: undefined }))
          }}
          help={typedAmount !== null ? standardHelp(typedAmount, agentsOnStandard) : null}
          error={errors.amount}
        />
        {changed && (
          <div className="ag-stack">
            <ReasonField
              id={`${ids}-reason`}
              value={reason}
              onChange={(value) => {
                setReason(value)
                setErrors((current) => ({ ...current, reason: undefined }))
              }}
              error={errors.reason}
            />
            <DiscountImpact impact={impact} />
          </div>
        )}
        {refusal && (
          <Note tone="bad" role="alert">
            {refusal}
          </Note>
        )}
      </form>
    </Sheet>
  )
}
