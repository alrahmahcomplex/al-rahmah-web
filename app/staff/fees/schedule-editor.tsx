"use client"

import { useId, useState, useTransition } from "react"

import { Button, Field, Note } from "@/components/kit"
import { BAND_NAMES, FEE_BANDS, type FeeAmounts, type FeeBand, type FeeField } from "@/lib/services/fees"

import { saveSchedule } from "./actions"
import { DateInput } from "./date-input"
import { FieldLabel } from "./field-label"
import type { SaveScheduleOutcome } from "./outcome"
import { bandClasses, INSTALMENTS } from "./format"

type Refused = Extract<SaveScheduleOutcome, { status: "refused" }>

const LOST_REQUEST: Refused = {
  status: "refused",
  field: null,
  message: "The change could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// The form's values, as typed.
type Draft = {
  bands: Record<FeeBand, { day: string; boarding: string }>
  split: { first: string; second: string; third: string }
  dueDates: { first: string; second: string; third: string }
  minimumDeposit: string
  preFormOne: { day: string; boarding: string }
}

function draftOf(amounts: FeeAmounts | null): Draft {
  const text = (value: number | undefined) => (value === undefined ? "" : String(value))
  return {
    bands: Object.fromEntries(
      FEE_BANDS.map((band) => [band, { day: text(amounts?.bands[band].day), boarding: text(amounts?.bands[band].boarding) }]),
    ) as Draft["bands"],
    split: {
      first: text(amounts?.split.first ?? 40),
      second: text(amounts?.split.second ?? 40),
      third: text(amounts?.split.third ?? 20),
    },
    dueDates: amounts?.dueDates ?? { first: "", second: "", third: "" },
    minimumDeposit: text(amounts?.minimumDeposit),
    preFormOne: { day: text(amounts?.preFormOne.day), boarding: text(amounts?.preFormOne.boarding) },
  }
}

// Spaces and thousands separators are allowed while typing. Anything that is
// not a whole number becomes NaN, which the database refuses by name.
function wholeNumber(typed: string): number {
  const digits = typed.replace(/[\s,]/g, "")
  return /^-?\d+(\.\d+)?$/.test(digits) ? Number(digits) : Number.NaN
}

function amountsOf(draft: Draft): FeeAmounts {
  return {
    bands: Object.fromEntries(
      FEE_BANDS.map((band) => [
        band,
        { day: wholeNumber(draft.bands[band].day), boarding: wholeNumber(draft.bands[band].boarding) },
      ]),
    ) as FeeAmounts["bands"],
    split: {
      first: wholeNumber(draft.split.first),
      second: wholeNumber(draft.split.second),
      third: wholeNumber(draft.split.third),
    },
    dueDates: { ...draft.dueDates },
    minimumDeposit: wholeNumber(draft.minimumDeposit),
    preFormOne: { day: wholeNumber(draft.preFormOne.day), boarding: wholeNumber(draft.preFormOne.boarding) },
  }
}

// A year's schedule for someone who may change it: the read-only tables with
// Edit amounts, or the form. A year with no schedule opens on the form.
export function ScheduleEditor({
  year,
  amounts,
  children,
}: {
  year: number
  amounts: FeeAmounts | null
  children?: React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  // The form stays until the refresh brings the new schedule in, so the
  // tables never show empty in between.
  if (amounts === null) {
    return (
      <div className="fs-stack">
        <p className="fs-text">No fee schedule for {year} yet. Enter every amount below to create it.</p>
        <ScheduleForm
          year={year}
          amounts={null}
          onSaved={() => setSaved(`The ${year} Fee schedule is saved.`)}
          onCancel={null}
        />
      </div>
    )
  }
  if (editing) {
    return (
      <ScheduleForm
        year={year}
        amounts={amounts}
        onSaved={() => {
          setEditing(false)
          setSaved("Fee amounts saved.")
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="fs-stack">
      <div className="fs-bar">
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={() => {
            setSaved(null)
            setEditing(true)
          }}
        >
          Edit amounts
        </Button>
        <p role="status" className="fs-saved">
          {saved}
        </p>
      </div>
      {children}
    </div>
  )
}

function ScheduleForm({
  year,
  amounts,
  onSaved,
  onCancel,
}: {
  year: number
  amounts: FeeAmounts | null
  onSaved: () => void
  onCancel: (() => void) | null
}) {
  const [draft, setDraft] = useState(() => draftOf(amounts))
  const [refusal, setRefusal] = useState<Refused | null>(null)
  const [pending, startTransition] = useTransition()
  const invalid = (...fields: FeeField[]) => (refusal?.field && fields.includes(refusal.field)) || undefined
  const shares = INSTALMENTS.map(([, key]) => wholeNumber(draft.split[key]))
  const shareTotal = shares.every(Number.isFinite) ? shares.reduce((a, b) => a + b, 0) : null

  function save() {
    setRefusal(null)
    startTransition(async () => {
      let outcome: SaveScheduleOutcome
      try {
        outcome = await saveSchedule(year, amountsOf(draft))
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "saved") onSaved()
      else setRefusal(outcome)
    })
  }

  return (
    <form
      aria-label={`Fee schedule ${year}`}
      className="fs-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <fieldset>
        <legend className="fs-legend">Annual school fees, in TZS</legend>
        {FEE_BANDS.map((band) => (
          <fieldset key={band}>
            <legend className="fs-sublegend">
              {BAND_NAMES[band]} <small>({bandClasses(band)})</small>
            </legend>
            <div className="fs-two">
              <AmountField
                label={`${BAND_NAMES[band]} Day fee`}
                shortLabel="Day"
                value={draft.bands[band].day}
                invalid={invalid(`${band}.day_fee`)}
                onChange={(day) => setDraft({ ...draft, bands: { ...draft.bands, [band]: { ...draft.bands[band], day } } })}
              />
              <AmountField
                label={`${BAND_NAMES[band]} Boarding fee`}
                shortLabel="Boarding"
                value={draft.bands[band].boarding}
                invalid={invalid(`${band}.boarding_fee`)}
                onChange={(boarding) =>
                  setDraft({ ...draft, bands: { ...draft.bands, [band]: { ...draft.bands[band], boarding } } })
                }
              />
            </div>
          </fieldset>
        ))}
      </fieldset>

      <fieldset>
        <legend className="fs-legend">Instalments</legend>
        {INSTALMENTS.map(([label, key]) => (
          <div key={key} className="fs-instalment">
            <AmountField
              label={`${label} instalment share (%)`}
              shortLabel={`${label} (%)`}
              value={draft.split[key]}
              invalid={invalid(`${key}_share`, "split")}
              onChange={(share) => setDraft({ ...draft, split: { ...draft.split, [key]: share } })}
            />
            <DateField
              label={`${label} instalment due date`}
              shortLabel="Due date"
              value={draft.dueDates[key]}
              invalid={invalid(`${key}_due`)}
              onChange={(due) => setDraft({ ...draft, dueDates: { ...draft.dueDates, [key]: due } })}
            />
          </div>
        ))}
        <p className="fs-hint" aria-live="polite">
          The three shares must add up to 100%.{shareTotal !== null && ` Now: ${shareTotal}%.`}
        </p>
      </fieldset>

      <fieldset>
        <legend className="fs-legend">Deposit and programmes, in TZS</legend>
        <AmountField
          label="Minimum Initial deposit"
          value={draft.minimumDeposit}
          invalid={invalid("minimum_deposit")}
          onChange={(minimumDeposit) => setDraft({ ...draft, minimumDeposit })}
        />
        <div className="fs-two">
          <AmountField
            label="Pre-Form One programme Day fee"
            shortLabel="Pre-Form One, Day"
            value={draft.preFormOne.day}
            invalid={invalid("pre_form_one_day_fee")}
            onChange={(day) => setDraft({ ...draft, preFormOne: { ...draft.preFormOne, day } })}
          />
          <AmountField
            label="Pre-Form One programme Boarding fee"
            shortLabel="Pre-Form One, Boarding"
            value={draft.preFormOne.boarding}
            invalid={invalid("pre_form_one_boarding_fee")}
            onChange={(boarding) => setDraft({ ...draft, preFormOne: { ...draft.preFormOne, boarding } })}
          />
        </div>
      </fieldset>

      {refusal && (
        <Note tone="bad" role="alert">
          {refusal.message} Nothing was saved.
        </Note>
      )}
      <div className="fs-actions">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : amounts === null ? "Create schedule" : "Save"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

type FieldProps = {
  label: string
  shortLabel?: string
  value: string
  invalid: true | undefined
  onChange: (value: string) => void
}

// An amount, share or count: whole numbers, right-aligned with tabular
// figures, as the tables show them.
function AmountField({ label, shortLabel, value, invalid, onChange }: FieldProps) {
  const id = useId()
  return (
    <div className="fs-field">
      <FieldLabel htmlFor={id} label={label} shortLabel={shortLabel} />
      <Field
        id={id}
        size="compact"
        inputMode="numeric"
        autoComplete="off"
        className="fs-money"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        invalid={invalid}
      />
    </div>
  )
}

// A due date, through the one date-field boundary (./date-input).
function DateField({ label, shortLabel, value, invalid, onChange }: FieldProps) {
  const id = useId()
  return (
    <div className="fs-field">
      <FieldLabel htmlFor={id} label={label} shortLabel={shortLabel} />
      <DateInput id={id} value={value} invalid={invalid} onChange={onChange} />
    </div>
  )
}
