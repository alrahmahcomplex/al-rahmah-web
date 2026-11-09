"use client"

import { useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { DISCOUNT_TEXT_MAX, type DiscountKind } from "@/lib/services/discounts"

import { requestDiscountAction } from "./discount-actions"
import { discountLabel, NOTE_HINT } from "./discount-outcome"
import { Field, SELECT_CLASS } from "./lead-editors"

const LOST_REQUEST = "The request could not be confirmed. Check your connection and press Request discount again; it won't be sent twice."

// Request discount on the discount panel. The form opens in place of the
// button and offers the kinds the lead doesn't hold yet. One id per opened
// form, so a Request retried after a lost response is sent once.
export function RequestDiscount({ leadId, kinds }: { leadId: string; kinds: readonly DiscountKind[] }) {
  const [open, setOpen] = useState(false)
  const [requestId, setRequestId] = useState("")
  const [kind, setKind] = useState<DiscountKind | "">("")
  const [note, setNote] = useState("")
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function start() {
    setRequestId(crypto.randomUUID())
    setKind("")
    setNote("")
    setRefusal(null)
    setOpen(true)
  }

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRefusal(null)
    startTransition(async () => {
      try {
        const outcome = await requestDiscountAction(leadId, kind, note, requestId)
        if (outcome.status === "done") setOpen(false)
        else setRefusal(outcome.message)
      } catch {
        setRefusal(LOST_REQUEST)
      }
    })
  }

  if (!open) {
    return (
      <div>
        <Button type="button" size="sm" variant="outline" onClick={start}>
          Request discount
        </Button>
      </div>
    )
  }

  return (
    <form aria-label="Request discount" className="flex flex-col gap-4" onSubmit={send}>
      {refusal && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}
      <Field label="Discount">
        {({ id }) => (
          <select id={id} className={SELECT_CLASS} required value={kind} onChange={(event) => setKind(event.target.value as DiscountKind)}>
            <option value="" disabled>
              Choose a discount
            </option>
            {kinds.map((choice) => (
              <option key={choice} value={choice}>
                {discountLabel(choice)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Note for the Manager" hint={NOTE_HINT}>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            required
            value={note}
            maxLength={DISCOUNT_TEXT_MAX}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Request discount"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
