"use client"

import { useOptimistic, useState, useTransition } from "react"

import { Button, Card, EmptyState, PageHeader, Table } from "@/components/kit"
import type { PromoCode, PromoState } from "@/lib/services/promo-codes"

import { DiscountChip } from "../agents/discount-fields"
import { changePromoState } from "./actions"
import { effectiveState, PROMO_LOST, promoAmountLine, promoStateChip, type PromoOutcome } from "./messages"
import { PromoSheet } from "./promo-sheet"
import "../agents/agents.css"
import { toast } from "../agents/form-parts"

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
      toast(outcome.message)
    })
  }

  const newButton = canManage && <Button onClick={() => openSheet("new")}>New Promo code</Button>

  return (
    <div className="ag-page">
      <PageHeader
        title="Promo codes"
        subtitle="Codes for campaigns and groups. No agent, no commission, no login."
        // With no codes yet, the empty list holds the one action.
        actions={shown.length > 0 && newButton}
      />

      {shown.length === 0 ? (
        <Card role="status">
          <EmptyState title="No Promo codes yet" action={newButton || undefined} />
        </Card>
      ) : (
        <Card>
          <Table
            label="Promo codes"
            rows={shown}
            rowKey={(code) => code.id}
            // The whole row opens the code's sheet (#343: named "Open …", so a screen reader says what it does).
            onOpen={(code) => openSheet(code.id)}
            rowLabel={(code) => `Open ${code.code}`}
            columns={[
              { header: "Code", rowHeader: true, cell: (code) => <span className="ag-mono ag-nowrap">{code.code}</span> },
              {
                header: "Name",
                cell: (code) => (
                  <span className="ag-cell">
                    <span className="ag-strong">{code.name}</span>
                    {code.note && <small>{code.note}</small>}
                  </span>
                ),
              },
              {
                header: "Interview discount",
                cell: (code) => {
                  const amount = promoAmountLine(code.amount)
                  return (
                    <span className="ag-nowrap">
                      <span className="ag-strong ag-num">{amount.off}</span> <span className="ag-quiet">{amount.fee}</span>
                    </span>
                  )
                },
              },
              {
                header: "Status",
                cell: (code) => {
                  const chip = promoStateChip(code.effectiveState)
                  return <DiscountChip tone={chip.tone}>{chip.label}</DiscountChip>
                },
              },
              { header: "Students", align: "end", cell: (code) => code.studentCount },
            ]}
          />
        </Card>
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
