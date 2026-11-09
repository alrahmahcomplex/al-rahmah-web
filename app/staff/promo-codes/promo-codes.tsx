"use client"

import { ChevronRightIcon, TicketPercentIcon } from "lucide-react"
import { useOptimistic, useState, useTransition } from "react"
import { toast } from "sonner"

import { EmptyState } from "@/components/staff/empty-state"
import { Button } from "@/components/ui/button"
import type { PromoCode, PromoState } from "@/lib/services/promo-codes"

import { DiscountChip } from "../agents/discount-fields"
import { changePromoState } from "./actions"
import { effectiveState, PROMO_LOST, promoAmountLine, promoStateChip, type PromoOutcome } from "./messages"
import { PromoSheet } from "./promo-sheet"

// The Promo codes page below its heading line: New Promo code, the list,
// and the sheet a row opens. Pause, Resume and End show on the row and in
// the sheet at once, and go back if the database refuses them, with the
// reason in the sheet.
export function PromoCodes({
  codes,
  highestAgentAmount,
  canManage,
  today,
}: {
  codes: PromoCode[]
  // The most an agent's code gives now, or null when it couldn't be read.
  highestAgentAmount: number | null
  canManage: boolean
  today: string
}) {
  const [shown, setState] = useOptimistic(codes, (list, change: { id: string; state: PromoState }) =>
    list.map((promo) =>
      promo.id === change.id ? { ...promo, state: change.state, effectiveState: effectiveState(change.state, promo.endsOn, today) } : promo,
    ),
  )
  // Which sheet is open: a code's id, or "new". Each opening starts afresh.
  const [sheet, setSheet] = useState<{ id: string | "new"; opening: number; open: boolean }>({ id: "new", opening: 0, open: false })
  const [stateRefusal, setStateRefusal] = useState<string | null>(null)
  const [statePending, startStateChange] = useTransition()
  const promo = sheet.id === "new" ? null : (shown.find((code) => code.id === sheet.id) ?? null)

  function openSheet(id: string | "new") {
    setStateRefusal(null)
    setSheet((current) => ({ id, opening: current.opening + 1, open: true }))
  }

  function changeOpen(open: boolean) {
    if (statePending) return
    setSheet((current) => ({ ...current, open }))
  }

  function changeState(id: string, code: string, to: PromoState, reason: string) {
    setStateRefusal(null)
    startStateChange(async () => {
      setState({ id, state: to })
      let outcome: PromoOutcome
      try {
        outcome = await changePromoState(id, to, reason, code)
      } catch {
        outcome = { status: "refused", message: PROMO_LOST }
      }
      if (outcome.status === "refused") return setStateRefusal(outcome.message)
      setSheet((current) => ({ ...current, open: false }))
      toast.success(outcome.message)
    })
  }

  const newButton = canManage && (
    <Button type="button" variant="orange" onClick={() => openSheet("new")}>
      New Promo code
    </Button>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="staff-heading">Promo codes</h1>
          <p className="text-sm text-muted-foreground">Codes for campaigns and groups. No agent, no commission, no login.</p>
        </div>
        {/* With no codes yet, the empty list holds the one action. */}
        {shown.length > 0 && newButton}
      </div>

      {shown.length === 0 ? (
        <EmptyState role="status" icon={TicketPercentIcon} title="No Promo codes yet" action={newButton || undefined} />
      ) : (
        <div className="relative overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <table aria-label="Promo codes" className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Code</th>
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Interview discount</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Students</th>
                <th scope="col" className="w-10 px-3 py-2">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((code) => {
                const chip = promoStateChip(code.effectiveState)
                const amount = promoAmountLine(code.amount)
                return (
                  <tr key={code.id} className="relative border-b align-top last:border-b-0 hover:bg-slate-50">
                    <th scope="row" className="px-3 py-2.5">
                      {/* The button covers the row, so the whole row opens the sheet. */}
                      <button
                        type="button"
                        onClick={() => openSheet(code.id)}
                        aria-label={`Open ${code.code}`}
                        className="font-mono text-sm font-semibold text-slate-900 outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
                      >
                        {code.code}
                      </button>
                    </th>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-900">{code.name}</p>
                      {code.note && <p className="max-w-72 text-xs text-muted-foreground">{code.note}</p>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-medium text-slate-900 tabular-nums">{amount.off}</span>{" "}
                      <span className="text-muted-foreground">{amount.fee}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <DiscountChip tone={chip.tone}>{chip.label}</DiscountChip>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{code.studentCount}</td>
                    <td className="px-3 py-2.5 text-slate-400">
                      <ChevronRightIcon aria-hidden className="size-4" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <PromoSheet
        key={sheet.opening}
        open={sheet.open}
        onOpenChange={changeOpen}
        promo={promo}
        highestAgentAmount={highestAgentAmount}
        canManage={canManage}
        statePending={statePending}
        stateRefusal={stateRefusal}
        onChangeState={(to, reason) => promo && changeState(promo.id, promo.code, to, reason)}
        onSaved={() => setSheet((current) => ({ ...current, open: false }))}
      />
    </div>
  )
}
