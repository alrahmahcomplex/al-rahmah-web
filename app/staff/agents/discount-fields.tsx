"use client"

import { ChevronRightIcon, LockIcon } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import type { ImpactAnswer } from "./discount-actions"
import { DISCOUNT_REASON_MAX, familyNotice, impactSummary, IMPACT_LOST, NO_IMPACT, PAID_KEEP, tzs } from "./discount-outcome"
import type { ImpactState } from "./fee-impact"

// The pieces the discount sheets share: the TZS amount field, the state
// chip, the soft note, and the fee-impact disclosure.

export type ChipTone = "good" | "warn" | "bad" | "plain"

const TONES: Record<ChipTone, string> = {
  good: "bg-green-50 text-green-800",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-red-50 text-red-700",
  plain: "bg-slate-100 text-slate-700",
}

export function DiscountChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-[22px] w-fit shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap", TONES[tone])}>
      {children}
    </span>
  )
}

export function Note({ tone = "plain", children }: { tone?: "plain" | "good" | "warn"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px]/5",
        tone === "good" ? "bg-green-50 text-green-800" : tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-muted-foreground",
      )}
    >
      {children}
    </p>
  )
}

// "Only a role with … can change this." with the lock.
export function LockedNote({ children }: { children: ReactNode }) {
  return (
    <Note>
      <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </Note>
  )
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
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
          TZS
        </span>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={50000}
          step={500}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          className="pl-12 tabular-nums"
        />
      </div>
      {help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
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
      <p role="status" className="text-sm text-muted-foreground">
        Finding the families this changes…
      </p>
    )
  }
  if (impact.status === "refused") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{impact.message}</AlertDescription>
      </Alert>
    )
  }
  const families = impact.families
  if (families.length === 0) return <Note>{NO_IMPACT}</Note>
  return (
    <details className="group overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-3 text-sm font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        {impactSummary(families.length)}
        <ChevronRightIcon aria-hidden className="ml-auto size-4 text-slate-400 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 text-[13px]/5 text-muted-foreground">
        <ul aria-label="Families not yet Paid" className="flex max-h-48 list-disc flex-col gap-1 overflow-y-auto pl-4.5 text-slate-900">
          {families.map((family) => (
            <li key={family.leadId}>
              {family.studentName}, {family.className}
              <span className="block text-muted-foreground">
                {family.contactName} ·{" "}
                <a href={`tel:${family.contactPhone}`} className="underline-offset-4 hover:underline">
                  {family.contactPhone}
                </a>{" "}
                · {tzs(family.feeNow)} → {tzs(family.feeAfter)}
              </span>
            </li>
          ))}
        </ul>
        <p>{PAID_KEEP}</p>
        <p>
          Tell each family: <span lang="sw" className="text-slate-900">“{familyNotice(families)}”</span>
        </p>
      </div>
    </details>
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
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Reason</Label>
      <Input
        id={id}
        value={value}
        maxLength={DISCOUNT_REASON_MAX}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// A radio drawn as a card: the title, and a line under it.
export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  title,
  line,
}: {
  name: string
  value: string
  checked: boolean
  onChange: () => void
  title: ReactNode
  line: ReactNode
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 ring-1 transition-colors motion-reduce:transition-none",
        checked ? "bg-blue-50 ring-blue-600" : "ring-slate-300 hover:bg-slate-50",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-1 accent-blue-600" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-slate-900">{title}</span>
        <span className="text-[13px]/5 text-muted-foreground">{line}</span>
      </span>
    </label>
  )
}

// Name: value pairs in a read-only sheet.
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="font-medium text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
