"use client"

import { useId, useState, useTransition } from "react"
import { toast } from "sonner"

import { PendingButton } from "@/components/staff/pending-button"
import { SheetForm } from "@/components/staff/sheet-form"
import { Alert, AlertDescription } from "@/components/ui/alert"

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
      toast.success(outcome.message)
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-foreground/10">
      <p>
        <span className="text-muted-foreground">Standard discount</span>
        &nbsp; <span className="font-semibold text-slate-900 tabular-nums">{tzs(amount)} off</span>{" "}
        <span className="text-xs text-muted-foreground">{standardLine(agentsOnStandard)}</span>
      </p>
      {canManage && (
        <>
          <button
            type="button"
            onClick={() => changeOpen(true)}
            aria-label="Change the standard discount"
            className="rounded-sm font-medium text-blue-600 underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40"
          >
            Change
          </button>
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
    </div>
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
    <SheetForm
      open={open}
      onOpenChange={onOpenChange}
      title="Standard discount"
      meta={<span>What every agent&apos;s code gives unless the agent has an own amount.</span>}
      form={{ onSubmit: submit, noValidate: true }}
      footer={
        <PendingButton type="submit" pending={pending} pendingLabel="Saving…" disabled={!changed}>
          Save
        </PendingButton>
      }
    >
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
        <div className="flex flex-col gap-3">
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
        <Alert variant="destructive" role="alert">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}
    </SheetForm>
  )
}
