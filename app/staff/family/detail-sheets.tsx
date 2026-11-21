"use client"

import { useId, useRef, useState } from "react"

import { Button, ChipButtons, ChoiceTiles, ClassPicker, Field, FieldError, Note, Sheet, toast } from "@/components/kit"
import type { LeadPreviousSchool, PreviousSchoolType } from "@/lib/services/lead-details"
import { DAY_OR_BOARDING, type DayOrBoarding, type LeadClass } from "@/lib/services/leads"

import { CLASS_LEVELS, REGIONS } from "../check-in/new/model"
import { savePreviousSchool } from "../applicants/[id]/sibling-actions"
import { LOST, saveStudent, useSheetSave, type StudentDetails } from "./saving"

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
              window.setTimeout(() => {
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
  const [region, setRegion] = useState<string | null>(known?.region ?? null)
  const [find, setFind] = useState("")
  const { problem, setProblem, pending, run } = useSheetSave()
  const id = useId()

  const t = find.trim().toLowerCase()
  const shown = (t ? REGIONS.filter((r) => r.toLowerCase().includes(t)) : REGIONS).slice(0, 6)
  if (region && !shown.includes(region)) shown.unshift(region)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const n = name.trim().replace(/\s+/g, " ").toUpperCase()
    // The record's rule: two letters or more.
    if (n.length < 2) return setProblem("Type the school’s name.")
    if (!type) return setProblem("Choose private or public.")
    if (!region) return setProblem("Choose the region from the list.")
    run(
      async () => {
        try {
          const outcome = await savePreviousSchool(leadId, { kind: "school", name: n, type, region })
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
        <Field
          placeholder="School name"
          aria-label="School name"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={120}
          value={name}
          onChange={(event) => {
            setName(event.target.value.toUpperCase())
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
        <Field
          size="compact"
          icon="search"
          placeholder="Type to find a region"
          aria-label="Find a region"
          autoComplete="off"
          value={find}
          onChange={(event) => setFind(event.target.value)}
        />
        {shown.length > 0 ? (
          <ChipButtons
            label="Regions"
            options={shown.map((r) => ({ value: r, label: r }))}
            value={region}
            onChange={(r) => {
              setRegion(r)
              setProblem(null)
            }}
          />
        ) : (
          <p className="fam-q">No region by that name.</p>
        )}
        <FieldError id={`${id}-error`} message={problem ?? undefined} />
      </form>
    </Sheet>
  )
}
