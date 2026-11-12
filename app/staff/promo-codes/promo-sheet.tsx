"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"

import { Button, Field, FieldError, Note as KitNote, Sheet } from "@/components/kit"
import type { PromoCode, PromoState } from "@/lib/services/promo-codes"

import { DiscountChip, DiscountImpact, Facts, LockedNote, MoneyField, Note, ReasonField, useImpact } from "../agents/discount-fields"
import { AMOUNT_HINT, feeBecomes, LOCKED_NOTE, parseAmount, plural, REASON_MISSING, tzs } from "../agents/discount-outcome"
import { DateField, Disclosure, toast } from "../agents/form-parts"
import { checkPromoCode, createPromo, readPromoImpact, updatePromo } from "./actions"
import {
  CODE_FIXED,
  CODE_INVALID,
  codeCheckLine,
  comparisonNote,
  ENDED_NOTE,
  formatDay,
  NAME_MISSING,
  NEW_PROMO_META,
  PROMO_CODE_PATTERN,
  PROMO_LOST,
  PROMO_NAME_MAX,
  PROMO_NOTE_MAX,
  promoStateChip,
  stateEffect,
  stateVerb,
  typedPromoCode,
  type CodeCheck,
  type PromoField,
  type PromoOutcome,
} from "./messages"
import "../agents/agents.css"

const NEW_AMOUNT = 25_000
const CHECK_DELAY_MS = 300

// A new Promo code, or one from the list. Roles without discount_codes.manage,
// and every Ended code, get the facts only.
export function PromoSheet({
  open,
  onOpenChange,
  promo,
  highestAgentAmount,
  canManage,
  statePending,
  stateRefusal,
  onChangeState,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Null: a new code.
  promo: PromoCode | null
  highestAgentAmount: number | null
  canManage: boolean
  statePending: boolean
  stateRefusal: string | null
  onChangeState: (to: PromoState, reason: string) => void
  onSaved: () => void
}) {
  // While an End is being saved the code already shows as Ended; the form
  // stays, so a refusal still has its place.
  const editable = canManage && (promo === null || promo.state !== "ended" || statePending)
  if (!editable && promo) {
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        placement="side"
        title={promo.code}
        chips={<PromoMeta promo={promo} />}
        closeLabel="Close"
        foot={
          <Button variant="ghost" size="wide" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        }
      >
        <Facts
          rows={[
            ["Name", promo.name],
            ["Gives", `${tzs(promo.amount)} off, fee ${tzs(50_000 - promo.amount)}`],
            ["Ends", promo.endsOn ? formatDay(promo.endsOn) : "No end date"],
            ["Note", promo.note || "—"],
          ]}
        />
        {promo.state === "ended" ? <Note>{ENDED_NOTE}</Note> : <LockedNote>{LOCKED_NOTE}</LockedNote>}
      </Sheet>
    )
  }
  return (
    <EditablePromo
      open={open}
      onOpenChange={onOpenChange}
      promo={promo}
      highestAgentAmount={highestAgentAmount}
      statePending={statePending}
      stateRefusal={stateRefusal}
      onChangeState={onChangeState}
      onSaved={onSaved}
    />
  )
}

function PromoMeta({ promo }: { promo: PromoCode }) {
  const chip = promoStateChip(promo.effectiveState)
  return (
    <span className="ag-row ag-quiet">
      <DiscountChip tone={chip.tone}>{chip.label}</DiscountChip>
      <span>{plural(promo.studentCount, "student")}</span>
      {promo.endsOn && <span>· ends {formatDay(promo.endsOn)}</span>}
    </span>
  )
}

type Errors = Partial<Record<PromoField, string>>

function EditablePromo({
  open,
  onOpenChange,
  promo,
  highestAgentAmount,
  statePending,
  stateRefusal,
  onChangeState,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  promo: PromoCode | null
  highestAgentAmount: number | null
  statePending: boolean
  stateRefusal: string | null
  onChangeState: (to: PromoState, reason: string) => void
  onSaved: () => void
}) {
  const ids = useId()
  const isNew = promo === null
  const [name, setName] = useState(promo?.name ?? "")
  const [code, setCode] = useState("")
  const [typed, setTyped] = useState(String(promo?.amount ?? NEW_AMOUNT))
  const [endsOn, setEndsOn] = useState(promo?.endsOn ?? "")
  const [note, setNote] = useState(promo?.note ?? "")
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const amount = parseAmount(typed)
  const check = useCodeCheck(isNew ? code : "")

  // What an edit changes; a new amount or last day needs a reason.
  const amountMoved = !isNew && amount !== promo.amount
  const endsMoved = !isNew && (endsOn || null) !== promo.endsOn
  const changed =
    isNew || amountMoved || endsMoved || name.trim() !== promo.name || (note.trim() || null) !== (promo.note ?? null)
  // A new last day moves fees as an amount does: an expired code given a
  // later day gives its amount again. The preview takes both.
  const impact = useImpact(
    !isNew && (amountMoved || endsMoved) && amount !== null ? `amount:${amount}|ends:${endsOn}` : null,
    () => readPromoImpact(promo!.id, { amount: amount ?? undefined, endsOn: endsOn || null }),
  )

  const busy = pending || statePending
  function changeOpen(next: boolean) {
    if (busy) return
    onOpenChange(next)
  }

  function clear(field: PromoField) {
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !changed) return
    const typedCode = typedPromoCode(code)
    const found: Errors = {
      name: name.trim() === "" ? NAME_MISSING : undefined,
      code: isNew && !PROMO_CODE_PATTERN.test(typedCode) ? CODE_INVALID : isNew && check.status === "taken" ? "This code is already in use." : undefined,
      amount: amount === null ? AMOUNT_HINT : undefined,
      reason: (amountMoved || endsMoved) && reason.trim() === "" ? REASON_MISSING : undefined,
    }
    setErrors(found)
    if (Object.values(found).some(Boolean) || amount === null) return
    setRefusal(null)
    const draft = { name, amount, endsOn: endsOn || null, note: note || null }
    startTransition(async () => {
      let outcome: PromoOutcome
      try {
        outcome = isNew
          ? await createPromo({ ...draft, code: typedCode })
          : await updatePromo(promo.id, draft, amountMoved || endsMoved ? reason : null, {
              code: promo.code,
              amount: promo.amount,
              endsOn: promo.endsOn,
            })
      } catch {
        outcome = { status: "refused", message: PROMO_LOST }
      }
      if (outcome.status === "refused") {
        if (outcome.field) setErrors((current) => ({ ...current, [outcome.field!]: outcome.message }))
        else setRefusal(outcome.message)
        return
      }
      onSaved()
      toast(outcome.message)
    })
  }

  const codeLine = isNew ? codeCheckLine(check) : { text: CODE_FIXED, problem: false }
  const compare = amount !== null && highestAgentAmount !== null ? comparisonNote(amount, highestAgentAmount) : null

  return (
    <Sheet
      open={open}
      onOpenChange={changeOpen}
      placement="side"
      title={isNew ? "New Promo code" : promo.code}
      hint={isNew ? NEW_PROMO_META : undefined}
      chips={isNew ? undefined : <PromoMeta promo={promo} />}
      closeLabel="Close"
      foot={
        <>
          <Button type="submit" form={`${ids}-form`} size="wide" pending={pending} disabled={!changed || statePending}>
            {pending ? (isNew ? "Creating…" : "Saving…") : isNew ? "Create code" : "Save"}
          </Button>
          <Button variant="ghost" size="wide" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={submit} noValidate className="ag-stack">
        <TextField
          id={`${ids}-name`}
          label="Name"
          value={name}
          maxLength={PROMO_NAME_MAX}
          placeholder="e.g. Instagram ad, November 2026"
          help="Staff see this. Parents never do."
          error={errors.name}
          onChange={(value) => {
            setName(value)
            clear("name")
          }}
        />
        <div className="ag-field">
          <label htmlFor={`${ids}-code`} className="ag-label">
            Code parents type
          </label>
          <Field
            id={`${ids}-code`}
            size="compact"
            alignStart
            value={isNew ? code : promo.code}
            readOnly={!isNew}
            maxLength={20}
            placeholder="e.g. INSTA26"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setCode(event.target.value)
              clear("code")
            }}
            invalid={Boolean(errors.code || codeLine.problem)}
            aria-describedby={`${ids}-code-help`}
            className="ag-mono ag-upper"
          />
          <p
            id={`${ids}-code-help`}
            role={isNew ? "status" : undefined}
            className={errors.code || codeLine.problem ? "ag-error" : "ag-hint"}
          >
            {errors.code ?? codeLine.text}
          </p>
        </div>
        <div className="ag-stack">
          <MoneyField
            id={`${ids}-amount`}
            label="Amount off the TZS 50,000 fee"
            value={typed}
            onChange={(value) => {
              setTyped(value)
              clear("amount")
            }}
            help={amount !== null ? feeBecomes(amount) : null}
            error={errors.amount}
          />
          {compare && <Note tone={compare.tone}>{compare.text}</Note>}
        </div>
        <Disclosure label="More options" open={Boolean(errors.endsOn || errors.note)}>
          <div className="ag-two">
            <EndsOnField
              id={`${ids}-ends`}
              value={endsOn}
              error={errors.endsOn}
              onChange={(value) => {
                setEndsOn(value)
                clear("endsOn")
              }}
            />
            <TextField
              id={`${ids}-note`}
              label="Note"
              value={note}
              maxLength={PROMO_NOTE_MAX}
              placeholder="Who it is for"
              error={errors.note}
              onChange={(value) => {
                setNote(value)
                clear("note")
              }}
            />
          </div>
        </Disclosure>
        {(amountMoved || endsMoved) && (
          <div className="ag-stack">
            <ReasonField
              id={`${ids}-reason`}
              value={reason}
              error={errors.reason}
              onChange={(value) => {
                setReason(value)
                clear("reason")
              }}
            />
            <DiscountImpact impact={impact} />
          </div>
        )}
        {refusal && (
          <KitNote tone="bad" role="alert">
            {refusal}
          </KitNote>
        )}
        {!isNew && (
          <StateChange
            promo={promo}
            pending={statePending}
            disabled={pending}
            refusal={stateRefusal}
            onConfirm={onChangeState}
          />
        )}
      </form>
    </Sheet>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  help,
  error,
  placeholder,
  maxLength,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  help?: string
  error?: string
  placeholder?: string
  maxLength?: number
}) {
  const described = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return (
    <div className="ag-field">
      <label htmlFor={id} className="ag-label">
        {label}
      </label>
      <Field
        id={id}
        size="compact"
        alignStart
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        invalid={Boolean(error)}
        aria-describedby={described}
      />
      {help && (
        <p id={`${id}-help`} className="ag-hint">
          {help}
        </p>
      )}
      <FieldError id={`${id}-error`} message={error} alignStart />
    </div>
  )
}

// The code's last day, or none: "YYYY-MM-DD", or "" for no end date.
function EndsOnField({ id, value, onChange, error }: { id: string; value: string; onChange: (value: string) => void; error?: string }) {
  const described = [`${id}-help`, error ? `${id}-error` : null].filter(Boolean).join(" ")
  return (
    <div className="ag-field">
      <label htmlFor={id} className="ag-label">
        Ends on
      </label>
      <DateField id={id} value={value} onChange={onChange} invalid={Boolean(error)} aria-describedby={described} />
      <p id={`${id}-help`} className="ag-hint">
        Leave empty for no end date.
      </p>
      <FieldError id={`${id}-error`} message={error} alignStart />
    </div>
  )
}

// Pause or Resume, and End, at the foot of the sheet. Each opens a confirm
// in place with a reason and the fees it moves.
function StateChange({
  promo,
  pending,
  disabled,
  refusal,
  onConfirm,
}: {
  promo: PromoCode
  pending: boolean
  disabled: boolean
  refusal: string | null
  onConfirm: (to: PromoState, reason: string) => void
}) {
  const ids = useId()
  const [to, setTo] = useState<PromoState | null>(null)
  const [reason, setReason] = useState("")
  const [missing, setMissing] = useState(false)
  const reasonRef = useRef<HTMLDivElement>(null)
  const impact = useImpact(to ? `state:${to}` : null, () => readPromoImpact(promo.id, { state: to ?? undefined }))
  const pauseOrResume: PromoState = promo.state === "paused" ? "active" : "paused"

  useEffect(() => {
    if (to) reasonRef.current?.querySelector("input")?.focus()
  }, [to])

  function confirm() {
    if (!to || pending) return
    if (reason.trim() === "") return setMissing(true)
    onConfirm(to, reason)
  }

  return (
    <div className="ag-inline">
      <div className="ag-row">
        {[pauseOrResume, "ended" as const].map((state) => (
          <Button
            key={state}
            variant="ghost"
            size="small"
            disabled={pending || disabled}
            aria-expanded={to === state}
            onClick={() => {
              setTo(state)
              setMissing(false)
            }}
          >
            {stateVerb(state)} code
          </Button>
        ))}
      </div>
      {to && (
        <div className="ag-stack">
          <p className="ag-p">
            <b className="ag-strong">
              {stateVerb(to)} {promo.code}?
            </b>{" "}
            <span className="ag-quiet">{stateEffect(to)}</span>
          </p>
          {/* Enter confirms here rather than saving the sheet's fields. */}
          <div
            ref={reasonRef}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                confirm()
              }
            }}
          >
            <ReasonField
              id={`${ids}-why`}
              value={reason}
              error={missing ? REASON_MISSING : null}
              onChange={(value) => {
                setReason(value)
                setMissing(false)
              }}
            />
          </div>
          <DiscountImpact impact={impact} />
          {refusal && (
            <KitNote tone="bad" role="alert">
              {refusal}
            </KitNote>
          )}
          <div className="ag-inline-act">
            <Button variant="ghost" size="small" disabled={pending} onClick={() => setTo(null)}>
              Keep as is
            </Button>
            <Button size="small" pending={pending} onClick={confirm}>
              {pending ? "Saving…" : `${stateVerb(to)} code`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// Whether the code typed is free, asked once typing pauses. A slower answer
// to an earlier code never replaces the answer to the latest.
function useCodeCheck(typed: string): CodeCheck {
  const code = typedPromoCode(typed)
  const readable = PROMO_CODE_PATTERN.test(code)
  const [answer, setAnswer] = useState<{ code: string; check: CodeCheck } | null>(null)
  const latest = useRef(code)

  useEffect(() => {
    latest.current = code
    if (!readable) return
    const timer = setTimeout(async () => {
      let check: CodeCheck
      try {
        check = await checkPromoCode(code)
      } catch {
        check = { status: "unavailable" }
      }
      if (latest.current === code) setAnswer({ code, check })
    }, CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [code, readable])

  if (code === "") return { status: "empty" }
  if (!readable) return { status: "unreadable" }
  if (!answer || answer.code !== code) return { status: "checking" }
  return answer.check
}
