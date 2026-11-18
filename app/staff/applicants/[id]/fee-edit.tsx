"use client"

import { useEffect, useId, useState, useTransition, type ReactNode } from "react"

import { Button, ButtonLink, ChipButtons, ChoiceTiles, Field, LoadingState, Note, Tag, TextLink, toast } from "@/components/kit"
import { FEE_EDIT_REASONS } from "@/lib/sibling-sentences"
import type { SiblingFeeEditReason, SiblingFeeEditValue } from "@/lib/services/sibling-groups"

import { formatShillings } from "../../fees/format"
import { leaveFeeAsItIs, previewFeeEdit, saveFeeEdit, type FeeEditPreview } from "./fee-edit-actions"
import { FEE_EDIT_REASON_ORDER, FEE_EDIT_VALUES, NOTE_MAX } from "./fee-edit-outcome"
import { TextArea } from "./form-controls"
import { RecordPayment } from "./record-payment"
import { useRefreshed } from "./sibling-group"
import type { SiblingFeeFacts } from "./sibling-read"
import type { Refused } from "./sibling-outcome"
import "./lead.css"

// The Accountant's part of the School fee (#311): Record payment with Edit
// fee and "Leave the fee as it is" beside it, and the form each opens in
// place, under the row. The prototype is
// https://claude.ai/artifact/P6NEbzyxA9JpdKjFzu6z6U (version 2).

const LOST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."
const tzs = (amount: number) => `TZS ${formatShillings(amount)}`

/** "Granted: fee edit needed", at the top of the School fee. */
export function FeeEditNeededTag({ fee }: { fee: SiblingFeeFacts }) {
  if (!fee.feeEditNeeded) return null
  return (
    <p className="fe-need">
      <Tag tone="wait">Granted: fee edit needed</Tag>
    </p>
  )
}

type Open = null | "fee" | "keep"

export function SiblingFeeControls({
  leadId,
  fee,
  recordHref,
  record,
  onChanged,
}: {
  leadId: string
  fee: SiblingFeeFacts
  // The side sheet: Record payment opens the record's School fee tab.
  recordHref?: string | null
  // The record: Record payment opens its form here.
  record?: { canWaive: boolean; canPayPreFormOne: boolean } | null
  onChanged?: () => void
}) {
  const [open, setOpen] = useState<Open>(null)
  const refreshed = useRefreshed(onChanged)
  const links = (
    <>
      {fee.canEdit && (
        <TextLink onClick={() => setOpen("fee")} aria-expanded={open === "fee"}>
          Edit fee
        </TextLink>
      )}
      {fee.canKeep && (
        <TextLink onClick={() => setOpen("keep")} aria-expanded={open === "keep"}>
          Leave the fee as it is
        </TextLink>
      )}
    </>
  )
  const anyLink = fee.canEdit || fee.canKeep
  let row: ReactNode = null
  if (record) row = <RecordPayment leadId={leadId} canWaive={record.canWaive} canPayPreFormOne={record.canPayPreFormOne} note={fee.paymentNote} beside={anyLink ? links : null} />
  else if (recordHref || anyLink)
    row = (
      <div className="lr-acts">
        {recordHref && (
          <ButtonLink href={recordHref} variant="ghost" size="small">
            Record payment
          </ButtonLink>
        )}
        {links}
      </div>
    )

  const done = (message: string) => {
    setOpen(null)
    toast(message, { tone: "good" })
    refreshed()
  }

  return (
    <>
      {row}
      {open === "fee" && <FeeEditForm key="fee" leadId={leadId} onCancel={() => setOpen(null)} onSaved={done} />}
      {open === "keep" && <KeepFeeForm key="keep" leadId={leadId} onCancel={() => setOpen(null)} onSaved={done} />}
    </>
  )
}

function ErrorLine({ id, message }: { id: string; message: string | null }) {
  return message ? (
    <p id={id} role="alert" className="lr-error">
      {message}
    </p>
  ) : null
}

// `waiting`: Save stays inactive, such as while "Before you save" loads.
function SaveRow({
  label,
  pendingLabel,
  pending,
  waiting = false,
  onCancel,
}: {
  label: string
  pendingLabel: string
  pending: boolean
  waiting?: boolean
  onCancel: () => void
}) {
  return (
    <div className="lr-acts fs-acts">
      <Button type="submit" size="small" pending={pending} aria-disabled={waiting || undefined}>
        {pending ? pendingLabel : label}
      </Button>
      <Button variant="ghost" size="small" aria-disabled={pending || undefined} onClick={() => !pending && onCancel()}>
        Cancel
      </Button>
    </div>
  )
}

/** Full fee, Sibling 10% or Back to automatic; what each sibling would pay; a reason from the list and a note. */
function FeeEditForm({ leadId, onCancel, onSaved }: { leadId: string; onCancel: () => void; onSaved: (message: string) => void }) {
  const [value, setValue] = useState<SiblingFeeEditValue | null>(null)
  const [reason, setReason] = useState<SiblingFeeEditReason | null>(null)
  const [note, setNote] = useState("")
  const [preview, setPreview] = useState<FeeEditPreview | Refused | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One id per edit as typed: a retry of the same edit is saved once, and a
  // changed edit is a new one, so a retry never collides with an earlier save.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const renew = () => setRequestId(crypto.randomUUID())
  const [pending, startTransition] = useTransition()
  const errorId = useId()
  const noteId = useId()

  // What the chosen value would change, read each time it changes.
  useEffect(() => {
    if (!value) return
    let gone = false
    previewFeeEdit(leadId, value).then(
      (answer) => !gone && setPreview(answer),
      () => !gone && setPreview({ status: "refused", message: "What the change would do could not be worked out. Try again in a moment." }),
    )
    return () => {
      gone = true
    }
  }, [leadId, value])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!value) return setError("Choose the fee.")
    if (preview?.status === "ready" && preview.unchanged) return setError("Nothing would change.")
    if (!reason) return setError("Choose the reason.")
    // Save waits until the Accountant has seen what it changes.
    if (preview?.status !== "ready") return
    setError(null)
    startTransition(async () => {
      let outcome: Awaited<ReturnType<typeof saveFeeEdit>>
      try {
        outcome = await saveFeeEdit(leadId, value, reason, note, requestId)
      } catch {
        outcome = { status: "refused", message: LOST }
      }
      if (outcome.status === "refused") return setError(outcome.message)
      onSaved("Fee saved. The change and its reason are in the audit log.")
    })
  }

  const siblingsMove = preview?.status === "ready" && preview.rows.some((r) => !r.here && r.changed)

  return (
    <form noValidate onSubmit={submit} className="fs-form" aria-label="Edit fee">
      <ChoiceTiles
        name={`${leadId}-fee-edit`}
        layout="three"
        legend={<span className="sr-only">The fee</span>}
        options={FEE_EDIT_VALUES.map((v) => ({ value: v.value, label: v.label }))}
        value={value}
        onChange={(next) => {
          setValue(next as SiblingFeeEditValue)
          setPreview(null)
          setError(null)
          renew()
        }}
      />
      {value && (
        <div className="fe-pv">
          <p className="fe-pvh">Before you save</p>
          {preview === null ? (
            <LoadingState label="Working out what changes…" />
          ) : preview.status === "refused" ? (
            <Note tone="bad" role="alert">
              {preview.message}
            </Note>
          ) : (
            <>
              <ul className="fe-imp">
                {preview.rows.map((r) => (
                  <li key={r.leadId} data-here={r.here || undefined}>
                    <div className="fe-l">
                      <b>{r.firstName}</b>
                      <small>
                        {r.status}
                        {r.here ? " · this student" : ""}
                      </small>
                    </div>
                    <div className="fe-r">
                      {r.changed && r.after !== null && r.before !== null ? (
                        <>
                          <b>{tzs(r.after)}</b>
                          <small>{r.afterWhy}</small>
                          <small>was {tzs(r.before)}</small>
                        </>
                      ) : (
                        <>
                          <b className="fe-dim">No change</b>
                          {r.before !== null && <small>{tzs(r.before)}</small>}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {!siblingsMove && <p className="fe-none">No sibling’s fee changes.</p>}
            </>
          )}
        </div>
      )}
      <p className="lr-hint">Reason for the change</p>
      <ChipButtons
        label="Reason for the change"
        options={FEE_EDIT_REASON_ORDER.map((r) => ({ value: r, label: FEE_EDIT_REASONS[r].en }))}
        value={reason}
        onChange={(next) => {
          setReason(next as SiblingFeeEditReason)
          setError(null)
          renew()
        }}
      />
      <Field
        id={noteId}
        size="compact"
        alignStart
        placeholder="Note (optional)"
        aria-label="Note, optional"
        autoComplete="off"
        maxLength={NOTE_MAX}
        value={note}
        onChange={(event) => {
          setNote(event.target.value)
          setError(null)
          renew()
        }}
      />
      <ErrorLine id={errorId} message={error} />
      <SaveRow
        label="Save the fee"
        pendingLabel="Saving…"
        pending={pending}
        waiting={value !== null && preview?.status !== "ready"}
        onCancel={onCancel}
      />
    </form>
  )
}

/** Closes "Granted: fee edit needed" without changing the fee, with a reason. */
function KeepFeeForm({ leadId, onCancel, onSaved }: { leadId: string; onCancel: () => void; onSaved: (message: string) => void }) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fieldId = useId()
  const errorId = useId()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim() === "") return setError("Write why the fee stays as it is.")
    setError(null)
    startTransition(async () => {
      let outcome: Awaited<ReturnType<typeof leaveFeeAsItIs>>
      try {
        outcome = await leaveFeeAsItIs(leadId, reason)
      } catch {
        outcome = { status: "refused", message: LOST }
      }
      if (outcome.status === "refused") return setError(outcome.message)
      onSaved("Saved. The fee stays as it is.")
    })
  }

  return (
    <form noValidate onSubmit={submit} className="fs-form" aria-label="Leave the fee as it is">
      <label htmlFor={fieldId} className="lr-label">
        Why does the fee stay as it is?
      </label>
      <TextArea
        id={fieldId}
        rows={2}
        autoFocus
        maxLength={NOTE_MAX}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value)
          setError(null)
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      <ErrorLine id={errorId} message={error} />
      <SaveRow label="Save" pendingLabel="Saving…" pending={pending} onCancel={onCancel} />
    </form>
  )
}
