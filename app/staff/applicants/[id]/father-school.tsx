"use client"

import { useId, useState, useTransition } from "react"

import { Icon as GuidedIcon, TypeAheadField } from "@/components/guided-form"
import { FatherNameBoxes, type FatherName } from "@/components/guided-form/names"
import { Button, ChipButtons, ChoiceTiles, Field, Tag, TextLink, toast } from "@/components/kit"
import { COUNTRY_NAMES, countryFlag, OUTSIDE_TANZANIA } from "@/lib/places"
import type { LeadPreviousSchool, PreviousSchoolType } from "@/lib/services/lead-details"
import type { LeadClass } from "@/lib/services/leads"

import { NO_SCHOOL_ASKED, REGIONS } from "../../check-in/new/model"
import { useFatherNameFlow } from "./father-flow"
import { savePreviousSchool } from "./sibling-actions"
import { useRefreshed } from "./sibling-group"
import type { SiblingPerson } from "./sibling-read"
import "./lead.css"

// The father's full name and the previous school under Student, on the lead
// record and in the Applicants side sheet (#310), each with its Edit (or
// Add) for staff with leads.edit. A father's name close to a sibling's asks
// "One name, or two?" before anything is saved; one that no longer matches
// says what changed and offers the Sibling request (father-flow.tsx).

const LOST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."
const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name" }

export const clean = (part: string) => part.trim().replace(/\s+/g, " ").toUpperCase()
export const norm = (name: string | null) =>
  (name ?? "")
    .toLowerCase()
    .replace(/[.,'’-]/g, "")
    .replace(/\s+/g, " ")
    .trim()

// Three boxes from a stored name: the first word, the middle words, the last.
export function partsOf(name: string | null): FatherName {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { fatherFirst: "", fatherMiddle: "", fatherLast: "" }
  if (words.length === 1) return { fatherFirst: words[0], fatherMiddle: "", fatherLast: "" }
  return { fatherFirst: words[0], fatherMiddle: words.slice(1, -1).join(" "), fatherLast: words[words.length - 1] }
}

export function FatherNameRow({
  leadId,
  studentName,
  father,
  enrolled,
  // The sibling a request compares with, for the request after a change.
  compareWith,
  canEdit,
  onChanged,
}: {
  leadId: string
  studentName: string
  father: string | null
  enrolled: boolean
  compareWith: SiblingPerson | null
  canEdit: boolean
  onChanged?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [parts, setParts] = useState<FatherName>(() => partsOf(father))
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()
  const { send, pending, sheets } = useFatherNameFlow({
    leadId,
    studentName,
    father,
    enrolled,
    compareWith,
    onChanged,
    onSaved: ({ message }) => {
      setEditing(false)
      if (message) toast(message)
    },
    onRefused: setError,
  })

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const typed = [parts.fatherFirst, parts.fatherMiddle, parts.fatherLast].map(clean)
    if (typed.some((part) => part === "")) return setError("Type all three of the father’s names.")
    const name = typed.join(" ")
    if (norm(name) === norm(father)) {
      setEditing(false)
      toast("Nothing changed.")
      return
    }
    setError(null)
    send(name)
  }

  return (
    <div className="fs-row">
      <dl className="kit-kv">
        <dt>Father’s full name</dt>
        <dd>
          {father ? <span>{father}</span> : <Tag tone="line">Not recorded yet</Tag>}
          {canEdit && !editing && (
            <TextLink
              aria-label="Edit father’s full name"
              onClick={() => {
                setParts(partsOf(father))
                setError(null)
                setEditing(true)
              }}
            >
              Edit
            </TextLink>
          )}
        </dd>
      </dl>
      {editing && (
        <form noValidate onSubmit={submit} className="fs-form" aria-label="Edit father’s full name">
          <FatherNameBoxes
            id={`${leadId}-father`}
            labels={NAME_LABELS}
            value={parts}
            onChange={(value) => {
              setParts(value)
              setError(null)
            }}
            invalid={error ? { fatherFirst: !parts.fatherFirst.trim(), fatherMiddle: !parts.fatherMiddle.trim(), fatherLast: !parts.fatherLast.trim() } : undefined}
            aria-describedby={error ? errorId : undefined}
            maxLength={60}
          />
          {error && (
            <p id={errorId} role="alert" className="lr-error">
              {error}
            </p>
          )}
          <div className="lr-acts fs-acts">
            <Button type="submit" size="small" pending={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" size="small" aria-disabled={pending || undefined} onClick={() => !pending && setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {sheets}
    </div>
  )
}

const schoolLine = (school: Extract<LeadPreviousSchool, { kind: "school" }>) =>
  `${school.name} · ${school.type === "private" ? "Private" : "Public"} · ${school.region === OUTSIDE_TANZANIA && school.country ? school.country : school.region}`

// The country of a school Outside Tanzania, as on the Family page (#511).
const COUNTRY_OPTIONS = COUNTRY_NAMES.map((c) => ({ value: c, label: c }))
const COUNTRY_LABELS = {
  field: "Country",
  placeholder: "Type or choose a country",
  showAll: "Show all countries",
  search: "Search countries",
  list: "Countries",
  none: (q: string) => `No country matches “${q}”.`,
}
const flag = (country: string) => <span className="gf-flag">{countryFlag(country)}</span>

export function PreviousSchoolRow({
  leadId,
  className,
  school,
  canEdit,
  onChanged,
}: {
  leadId: string
  className: LeadClass
  school: LeadPreviousSchool
  canEdit: boolean
  onChanged?: () => void
}) {
  const asked = !NO_SCHOOL_ASKED.includes(className)
  const known = school?.kind === "school" ? school : null
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(known?.name ?? "")
  const [type, setType] = useState<PreviousSchoolType | null>(known?.type ?? null)
  const [region, setRegion] = useState<string | null>(known?.region ?? null)
  const [country, setCountry] = useState(known?.country ?? "")
  const [find, setFind] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const refreshed = useRefreshed(onChanged)
  const errorId = useId()
  const nameId = useId()

  const t = find.trim().toLowerCase()
  const shown = (t ? REGIONS.filter((r) => r.toLowerCase().includes(t)) : REGIONS).slice(0, 6)
  if (region && !shown.includes(region)) shown.unshift(region)

  function open() {
    setName(known?.name ?? "")
    setType(known?.type ?? null)
    setRegion(known?.region ?? null)
    setCountry(known?.country ?? "")
    setFind("")
    setError(null)
    setEditing(true)
  }

  function save(input: Parameters<typeof savePreviousSchool>[1], message: string) {
    setError(null)
    startTransition(async () => {
      let outcome: Awaited<ReturnType<typeof savePreviousSchool>>
      try {
        outcome = await savePreviousSchool(leadId, input)
      } catch {
        outcome = { status: "refused", message: LOST }
      }
      if (outcome.status === "refused") return setError(outcome.message)
      setEditing(false)
      toast(message)
      refreshed()
    })
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const n = name.trim().replace(/\s+/g, " ")
    if (n.length < 2) return setError("Type the school’s name.")
    if (!type || !region) return setError("Choose private or public, and the region.")
    const out = region === OUTSIDE_TANZANIA
    // Another school, or a new region, needs its country; private or public alone keeps the saved one (#511).
    if (out && !country && (n !== known?.name || region !== known?.region)) return setError("Choose the country from the list.")
    save({ kind: "school", name: n, type, region, ...(out && country ? { country } : {}) }, "Previous school saved.")
  }

  return (
    <div className="fs-row">
      <dl className="kit-kv">
        <dt>Previous school</dt>
        <dd>
          {!asked ? (
            <span className="lr-quiet">Not asked below STD 2</span>
          ) : known ? (
            <span>{schoolLine(known)}</span>
          ) : school?.kind === "not-known" ? (
            <Tag tone="wait">Not known yet</Tag>
          ) : (
            <Tag tone="bad">Missing</Tag>
          )}
          {asked && canEdit && !editing && (
            <TextLink aria-label={known ? "Edit previous school" : "Add previous school"} onClick={open}>
              {known ? "Edit" : "Add"}
            </TextLink>
          )}
        </dd>
      </dl>
      {editing && (
        <form noValidate onSubmit={submit} className="fs-form" aria-label="Previous school">
          <Field
            id={nameId}
            size="compact"
            alignStart
            placeholder="School name"
            aria-label="School name"
            autoComplete="off"
            maxLength={120}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
          />
          <ChoiceTiles
            name={`${leadId}-school-type`}
            layout="two"
            legend={<span className="sr-only">Private or public</span>}
            options={[
              { value: "private", label: "Private" },
              { value: "public", label: "Public" },
            ]}
            value={type}
            onChange={(value) => {
              setType(value as PreviousSchoolType)
              setError(null)
            }}
          />
          <Field
            size="compact"
            alignStart
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
                if (r !== OUTSIDE_TANZANIA) setCountry("")
                setError(null)
              }}
            />
          ) : (
            <p className="lr-hint">No region by that name.</p>
          )}
          {region === OUTSIDE_TANZANIA && (
            <>
              <p className="lr-hint">Which country is the school in?</p>
              <TypeAheadField
                id={`${nameId}-country`}
                compact
                options={COUNTRY_OPTIONS}
                value={country}
                onValueChange={(next) => {
                  setCountry(next)
                  setError(null)
                }}
                lead={(value) => (value ? flag(value) : <GuidedIcon name="globe" small />)}
                optionLead={flag}
                labels={COUNTRY_LABELS}
              />
            </>
          )}
          {error && (
            <p id={errorId} role="alert" className="lr-error">
              {error}
            </p>
          )}
          <div className="lr-acts fs-acts">
            <Button type="submit" size="small" pending={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" size="small" aria-disabled={pending || undefined} onClick={() => !pending && setEditing(false)}>
              Cancel
            </Button>
          </div>
          <TextLink className="fs-nk" onClick={() => !pending && save({ kind: "not-known" }, "Saved as Not known yet.")}>
            Not known yet
          </TextLink>
        </form>
      )}
    </div>
  )
}
