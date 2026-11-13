"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { ChoiceTiles, Field, FieldError, KeyValueList, Note as KitNote, Tag, type TagTone } from "@/components/kit"

import type { ImpactAnswer } from "./discount-actions"
import { DISCOUNT_REASON_MAX, familyNotice, impactSummary, IMPACT_LOST, NO_IMPACT, PAID_KEEP, tzs } from "./discount-outcome"
import type { ImpactState } from "./fee-impact"
import { Disclosure } from "./form-parts"
import "./agents.css"

// The pieces the discount sheets share: the TZS amount field, the state
// chip, the soft note, and the fee-impact disclosure.

export type ChipTone = "good" | "warn" | "bad" | "plain"

const TAG_TONES: Record<ChipTone, TagTone> = { good: "ok", warn: "wait", bad: "bad", plain: "line" }

export function DiscountChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <Tag tone={TAG_TONES[tone]}>{children}</Tag>
}

export function Note({ tone = "plain", children }: { tone?: "plain" | "good" | "warn"; children: ReactNode }) {
  return <KitNote tone={tone === "good" ? "good" : tone === "warn" ? "wait" : "info"}>{children}</KitNote>
}

// "Only a role with … can change this."
export function LockedNote({ children }: { children: ReactNode }) {
  return <KitNote>{children}</KitNote>
}

// Whole TZS, with the currency set inside the field.
export function MoneyField({
  id,
  label,
  value,
  onChange,
  help,
  error,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  help?: string | null
  error?: string | null
  disabled?: boolean
}) {
  const described = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return (
    <div className="ag-field">
      <label htmlFor={id} className="ag-label">
        {label}
      </label>
      <div className="ag-money">
        <span aria-hidden>TZS</span>
        <Field
          id={id}
          size="compact"
          alignStart
          type="number"
          inputMode="numeric"
          min={0}
          max={50000}
          step={500}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          invalid={Boolean(error)}
          aria-describedby={described}
        />
      </div>
      {help && (
        <p id={`${id}-help`} className="ag-hint">
          {help}
        </p>
      )}
      <FieldError id={`${id}-error`} message={error ?? undefined} alignStart />
    </div>
  )
}

const LOOKUP_DELAY_MS = 300

// The families a change would move, read again once typing pauses. A
// slower answer to an earlier amount never replaces the latest. Null `load`
// reads nothing (no change yet); `key` names what is being asked.
export function useImpact(key: string | null, load: () => Promise<ImpactAnswer>): ImpactState | null {
  const [answer, setAnswer] = useState<{ key: string; state: ImpactState } | null>(null)
  const latest = useRef(key)
  const loader = useRef(load)
  useEffect(() => {
    loader.current = load
  })

  useEffect(() => {
    latest.current = key
    if (key === null) return
    const timer = setTimeout(async () => {
      let state: ImpactState
      try {
        state = await loader.current()
      } catch {
        state = { status: "refused", message: IMPACT_LOST }
      }
      if (latest.current === key) setAnswer({ key, state })
    }, LOOKUP_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key])

  if (key === null) return null
  if (!answer || answer.key !== key) return { status: "loading" }
  return answer.state
}

// What the change does to interview fees not yet Paid: the count, then the
// families and the Swahili line to read to them.
export function DiscountImpact({ impact }: { impact: ImpactState | null }) {
  if (!impact) return null
  if (impact.status === "loading") {
    return (
      <p role="status" className="ag-p ag-quiet">
        Finding the families this changes…
      </p>
    )
  }
  if (impact.status === "refused") {
    return (
      <KitNote tone="bad" role="alert">
        {impact.message}
      </KitNote>
    )
  }
  const families = impact.families
  if (families.length === 0) return <Note>{NO_IMPACT}</Note>
  return (
    <Disclosure label={impactSummary(families.length)}>
      <div className="ag-fold">
        <ul aria-label="Families not yet Paid" className="ag-families">
          {families.map((family) => (
            <li key={family.leadId}>
              <span className="ag-strong">
                {family.studentName}, {family.className}
              </span>
              <small>
                {family.contactName} ·{" "}
                <a href={`tel:${family.contactPhone}`} className="ag-tel">
                  {family.contactPhone}
                </a>{" "}
                · {tzs(family.feeNow)} → {tzs(family.feeAfter)}
              </small>
            </li>
          ))}
        </ul>
        <p className="ag-p">{PAID_KEEP}</p>
        <p className="ag-p">
          Tell each family:{" "}
          <span lang="sw" className="ag-strong">
            “{familyNotice(families)}”
          </span>
        </p>
      </div>
    </Disclosure>
  )
}

// The reason a change needs, kept with its history.
export function ReasonField({
  id,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  error?: string | null
  placeholder?: string
}) {
  return (
    <div className="ag-field">
      <label htmlFor={id} className="ag-label">
        Reason
      </label>
      <Field
        id={id}
        size="compact"
        alignStart
        value={value}
        maxLength={DISCOUNT_REASON_MAX}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <FieldError id={`${id}-error`} message={error ?? undefined} alignStart />
    </div>
  )
}

// "Standard" or "Own amount", each with its line, as the kit's choice rows.
export function DiscountKindChoice({
  name,
  legend,
  value,
  onChange,
  options,
  children,
}: {
  name: string
  legend: ReactNode
  value: string
  onChange: (value: string) => void
  options: { value: string; title: ReactNode; line: ReactNode }[]
  // Inside the group, after the choices: the amount for "Own amount".
  children?: ReactNode
}) {
  return (
    <ChoiceTiles
      name={name}
      legend={legend}
      value={value}
      onChange={onChange}
      layout="rows"
      options={options.map((option) => ({ value: option.value, label: option.title, description: option.line }))}
    >
      {children}
    </ChoiceTiles>
  )
}

// Name: value pairs in a read-only sheet.
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <KeyValueList items={rows.map(([key, value]) => ({ key, value }))} />
}
