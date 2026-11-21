"use client"

import { useEffect, useId, useRef, useState } from "react"

import { CapitalsBox, Icon as GuidedIcon, Reveal, TypeAheadField } from "@/components/guided-form"
import { Button, ChoiceTiles, ClassPicker, FieldError, Note, Sheet, toast } from "@/components/kit"
import { COUNTRY_NAMES, countryFlag, OUTSIDE_TANZANIA, regionsOutsideFirst } from "@/lib/places"
import type { LeadPreviousSchool, PreviousSchoolType } from "@/lib/services/lead-details"
import { DAY_OR_BOARDING, type DayOrBoarding, type LeadClass } from "@/lib/services/leads"

import { CLASS_LEVELS, REGIONS } from "../check-in/new/model"
import { savePreviousSchool } from "../applicants/[id]/sibling-actions"
import { LOST, saveStudent, useSheetSave, type StudentDetails } from "./saving"

const OUTSIDE_LABEL = "Outside Tanzania (Other Country)"
const REGION_OPTIONS = regionsOutsideFirst(REGIONS).map((r) => ({ value: r, label: r === OUTSIDE_TANZANIA ? OUTSIDE_LABEL : r }))
const COUNTRY_OPTIONS = COUNTRY_NAMES.map((c) => ({ value: c, label: c }))
const flag = (country: string) => <span className="gf-flag">{countryFlag(country)}</span>
const listLabels = (one: string, many: string) => ({
  field: one[0].toUpperCase() + one.slice(1),
  placeholder: `Type or choose a ${one}`,
  showAll: `Show all ${many}`,
  search: `Search ${many}`,
  list: many[0].toUpperCase() + many.slice(1),
  none: (q: string) => `No ${one} matches “${q}”.`,
})

// The Family page's sheets for one answer each (#512, prototype v54): the
// class, Day or boarding and the previous school. Each saves through the
// lead record's own action. The card mounts each sheet afresh for every edit,
// so a sheet starts from the record as it is now.

const PICK_MS = 240

export function ClassSheet({ details, open, onOpenChange }: { details: StudentDetails; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { problem, setProblem, pending, run } = useSheetSave()
  // The first tap wins until its save ends.
  const choosing = useRef(false)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      placement="centre"
      title="Choose a class"
      hint={details.studentName}
      closeLabel="Close"
    >
      <div className="fam-form" aria-busy={pending || undefined}>
        <ClassPicker
          label="School level"
          levels={CLASS_LEVELS}
          picked={details.className}
          defaultLevel={1}
          onPick={(cls: LeadClass) => {
            if (pending || choosing.current) return
            if (cls === details.className) return onOpenChange(false)
            choosing.current = true
            run(
              () => saveStudent(details.leadId, { className: cls }),
              () => {
                onOpenChange(false)
                toast(`Class changed to ${cls}. The fee is worked out again.`)
              },
              (reason) => {
                choosing.current = false
                setProblem(reason)
              },
            )
          }}
        />
        {problem && (
          <Note tone="bad" role="alert">
            {problem}
          </Note>
        )}
      </div>
    </Sheet>
  )
}

export function BoardingSheet({ details, open, onOpenChange }: { details: StudentDetails; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { problem, setProblem, pending, run } = useSheetSave()
  const [picked, setPicked] = useState<DayOrBoarding>(details.dayOrBoarding)
  // The first pick wins: a second tap before its save ends is ignored, so two quick taps never save twice.
  const choosing = useRef(false)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  const id = useId()
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // From the pick until its save ends, the sheet stays: the save always finishes in this sheet.
        if (pending || choosing.current) return
        onOpenChange(next)
      }}
      placement="centre"
      title="Day or boarding?"
      hint={details.studentName}
      closeLabel="Close"
    >
      <div className="fam-form">
        <fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">
          <ChoiceTiles
            name={`${id}-board`}
            layout="two"
            big
            legend={<span className="sr-only">Day or boarding</span>}
            options={DAY_OR_BOARDING.map((value) => ({ value, label: value }))}
            value={picked}
            onChange={(value) => {
              if (choosing.current || pending) return
              choosing.current = true
              const next = value as DayOrBoarding
              setPicked(next)
              timer.current = window.setTimeout(() => {
                timer.current = null
                if (next === details.dayOrBoarding) return onOpenChange(false)
                run(
                  () => saveStudent(details.leadId, { dayOrBoarding: next }),
                  () => {
                    onOpenChange(false)
                    toast("Saved. The fee is worked out again.")
                  },
                  (reason) => {
                    // Refused: the sheet stays, and another pick may try again.
                    choosing.current = false
                    setProblem(reason)
                  },
                )
              }, PICK_MS)
            }}
          />
        </fieldset>
        {problem && (
          <Note tone="bad" role="alert">
            {problem}
          </Note>
        )}
      </div>
    </Sheet>
  )
}

export function SchoolSheet({
  leadId,
  studentName,
  school,
  open,
  onOpenChange,
}: {
  leadId: string
  studentName: string
  school: LeadPreviousSchool
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const known = school?.kind === "school" ? school : null
  const [name, setName] = useState(known?.name ?? "")
  const [type, setType] = useState<PreviousSchoolType | null>(known?.type ?? null)
  const [region, setRegion] = useState(known?.region ?? "")
  const [country, setCountry] = useState(known?.region === OUTSIDE_TANZANIA ? (known.country ?? "") : "")
  const { problem, setProblem, pending, run } = useSheetSave()
  const id = useId()
  const out = region === OUTSIDE_TANZANIA

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const n = name.trim().replace(/\s+/g, " ").toUpperCase()
    // The record's rule: two letters or more.
    if (n.length < 2) return setProblem("Type the school’s name.")
    if (!type) return setProblem("Choose private or public.")
    if (!region) return setProblem("Choose the region from the list.")
    // Another school, or a new region, needs its country; private or public alone keeps the saved one, or none
    // on a school saved before the country list (#511).
    if (out && !country && (n !== known?.name || region !== known?.region)) return setProblem("Choose the country from the list.")
    run(
      async () => {
        try {
          const outcome = await savePreviousSchool(leadId, {
            kind: "school",
            name: n,
            type,
            region,
            ...(out && country ? { country } : {}),
          })
          return outcome.status === "saved" ? outcome : { status: "refused", field: null, message: outcome.message }
        } catch {
          return { status: "refused", field: null, message: LOST }
        }
      },
      () => {
        onOpenChange(false)
        toast("Previous school saved.")
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      placement="centre"
      title="Previous school"
      hint={studentName}
      closeLabel="Close"
      foot={
        <Button type="submit" form={`${id}-form`} size="wide" chevron pending={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="fam-form">
        <fieldset disabled={pending} className="fam-form m-0 min-w-0 border-0 p-0">
          <CapitalsBox
            placeholder="School name"
            aria-label="School name"
            maxLength={120}
            value={name}
            onValueChange={(value) => {
              setName(value)
              setProblem(null)
            }}
          />
          <ChoiceTiles
            name={`${id}-type`}
            layout="two"
            legend={<span className="fam-q">Is it a private or a public school?</span>}
            options={[
              { value: "private", label: "Private" },
              { value: "public", label: "Public" },
            ]}
            value={type}
            onChange={(value) => {
              setType(value as PreviousSchoolType)
              setProblem(null)
            }}
          />
          <p className="fam-q" id={`${id}-region`}>
            Which region is the school in?
          </p>
          <TypeAheadField
            id={`${id}-region-field`}
            compact
            options={REGION_OPTIONS}
            pinned={OUTSIDE_TANZANIA}
            value={region}
            onValueChange={(next) => {
              setRegion(next)
              if (next !== "" && next !== OUTSIDE_TANZANIA) setCountry("")
              setProblem(null)
            }}
            lead={() => <GuidedIcon name="pin" small />}
            labels={listLabels("region", "regions")}
            aria-describedby={problem ? `${id}-error` : undefined}
          />
          <Reveal open={out}>
            <div className="fam-form pt-1">
              <p className="fam-q" id={`${id}-country`}>
                Which country is the school in?
              </p>
              <TypeAheadField
                id={`${id}-country-field`}
                compact
                options={COUNTRY_OPTIONS}
                value={country}
                onValueChange={(next) => {
                  setCountry(next)
                  setProblem(null)
                }}
                lead={(value) => (value ? flag(value) : <GuidedIcon name="globe" small />)}
                optionLead={flag}
                labels={listLabels("country", "countries")}
                aria-describedby={problem ? `${id}-error` : undefined}
              />
            </div>
          </Reveal>
        </fieldset>
        <FieldError id={`${id}-error`} message={problem ?? undefined} />
      </form>
    </Sheet>
  )
}
