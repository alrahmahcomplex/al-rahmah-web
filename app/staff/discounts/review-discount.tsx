"use client"

import Link from "next/link"
import { useId, useRef, useState } from "react"

import { Button, KeyValueList, Note, Sheet, toast } from "@/components/kit"

import { GRANT_EFFECT, REFUSE_EFFECT, RefuseReason, useDiscountDecision, useRefuseReason } from "../applicants/[id]/decide-discount"

type ReviewDiscountProps = {
  leadId: string
  requestId: string
  studentName: string
  admissionNumber: string
  // The lead's Discounts tab.
  leadHref: string
  // "Staff child (25% off)".
  discount: string
  // "STD 2 Day, 2027".
  place: string
  note: string
  // "Example Staff One on 12 Nov 2026".
  requestedByOn: string
  // False on a closed lead: the request can only be refused.
  canGrant: boolean
}

// Review on a row of Discount requests (#327): one centre sheet with the
// request, Grant and Refuse in its foot. Refuse asks for the reason in the
// same sheet, then refuses. The decision is the lead record's
// (useDiscountDecision); a decision that lands closes the sheet, shows a toast
// and refreshes the page, which drops the row.
export function ReviewDiscount(props: ReviewDiscountProps) {
  const { leadId, requestId, studentName, admissionNumber, leadHref, discount, place, note, requestedByOn, canGrant } = props
  const [open, setOpen] = useState(false)
  const [refusing, setRefusing] = useState(false)
  const why = useRefuseReason()
  const { refusal, clearRefusal, pending, grant, refuse } = useDiscountDecision(leadId, requestId)
  const formId = useId()
  const refuseRef = useRef<HTMLButtonElement>(null)

  // The sheet starts at the request each time it opens. Resetting on open,
  // not on close, keeps the reason step drawn while the sheet slides out.
  function changeOpen(next: boolean) {
    if (pending) return
    if (next) {
      setRefusing(false)
      why.clearMissing()
      clearRefusal()
    }
    setOpen(next)
  }

  function back() {
    if (pending) return
    setRefusing(false)
    why.clearMissing()
    clearRefusal()
    // The Refuse request button is drawn again in this render.
    requestAnimationFrame(() => refuseRef.current?.focus())
  }

  function submitRefusal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!why.check()) return
    refuse(why.reason, () => {
      setOpen(false)
      why.reset()
      toast(`Refused for ${studentName}. The desk can see it now.`)
    })
  }

  const failed = refusal && (
    <Note tone="bad" role="alert">
      {refusal}
    </Note>
  )

  return (
    <>
      <Button variant="ghost" size="small" onClick={() => changeOpen(true)}>
        Review
      </Button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        placement="centre"
        title={refusing ? `Refuse ${studentName} the discount?` : discount}
        hint={
          refusing ? (
            <>
              {admissionNumber}. {discount}. {REFUSE_EFFECT}
            </>
          ) : (
            studentName
          )
        }
        closeLabel="Close"
        foot={
          refusing ? (
            <>
              <Button type="submit" form={formId} variant="bad" size="wide" pending={pending}>
                {pending ? "Refusing…" : "Refuse request"}
              </Button>
              <Button variant="ghost" size="wide" onClick={back} aria-disabled={pending || undefined}>
                Back
              </Button>
            </>
          ) : (
            <>
              {canGrant && (
                <Button
                  size="wide"
                  chevron
                  pending={pending}
                  onClick={() =>
                    grant(() => {
                      setOpen(false)
                      toast(`Granted for ${studentName}. The desk can see it now.`, { tone: "good" })
                    })
                  }
                >
                  {pending ? "Granting…" : "Grant the discount"}
                </Button>
              )}
              <Button
                ref={refuseRef}
                variant="bad"
                size="wide"
                onClick={() => {
                  clearRefusal()
                  setRefusing(true)
                }}
                aria-disabled={pending || undefined}
              >
                Refuse request
              </Button>
            </>
          )
        }
      >
        {refusing ? (
          <form id={formId} className="lr-form" onSubmit={submitRefusal} noValidate>
            <RefuseReason reason={why.reason} missing={why.missing} onChange={why.change} autoFocus />
            {failed}
          </form>
        ) : (
          <div className="dr-review">
            <Note tone="wait">
              <span className="dr-note">{note}</span>
            </Note>
            <KeyValueList
              items={[
                {
                  key: "Admission Number",
                  value: (
                    <Link href={leadHref} className="dr-number">
                      {admissionNumber}
                    </Link>
                  ),
                },
                { key: "Class", value: place },
                { key: "Requested by", value: requestedByOn },
              ]}
            />
            {canGrant ? (
              <Note>{GRANT_EFFECT}</Note>
            ) : (
              <Note>This application is closed. It can be granted only after it is reopened.</Note>
            )}
            {failed}
          </div>
        )}
      </Sheet>
    </>
  )
}
