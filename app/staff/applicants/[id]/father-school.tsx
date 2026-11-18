"use client"

import { useId, useState, useTransition } from "react"

import { FatherNameBoxes, type FatherName } from "@/components/guided-form/names"
import { Button, ChipButtons, ChoiceTiles, Field, Note, Sheet, Tag, TextLink, toast } from "@/components/kit"
import type { LeadPreviousSchool, PreviousSchoolType } from "@/lib/services/lead-details"
import type { LeadClass } from "@/lib/services/leads"

import { NO_SCHOOL_ASKED, REGIONS } from "../../check-in/new/model"
import { saveFatherName, savePreviousSchool, type FatherOutcome } from "./sibling-actions"
import { Compare, SiblingRequestSheet, useRefreshed } from "./sibling-group"
import type { SiblingPerson } from "./sibling-read"
import "./lead.css"

// The father's full name and the previous school under Student, on the lead
// record and in the Applicants side sheet (#310), each with its Edit (or
// Add) for staff with leads.edit. A father's name close to a sibling's asks
// "One name, or two?" before anything is saved; one that no longer matches
// says what changed and offers the Sibling request.

const LOST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."
const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name" }
const PICK_MS = 240

const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name
const clean = (part: string) => part.trim().replace(/\s+/g, " ").toUpperCase()
const norm = (name: string | null) =>
  (name ?? "")
    .toLowerCase()
    .replace(/[.,'’-]/g, "")
    .replace(/\s+/g, " ")
    .trim()

// Three boxes from a stored name: the first word, the middle words, the last.
function partsOf(name: string | null): FatherName {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { fatherFirst: "", fatherMiddle: "", fatherLast: "" }
  if (words.length === 1) return { fatherFirst: words[0], fatherMiddle: "", fatherLast: "" }
  return { fatherFirst: words[0], fatherMiddle: words.slice(1, -1).join(" "), fatherLast: words[words.length - 1] }
}

type Flow =
  | { kind: "question"; name: string; sibling: SiblingPerson; holders: string[] }
  | { kind: "different"; father: string; sibling: SiblingPerson | null; sentence: string; moves: string[] }
  | { kind: "same-now"; father: string; sibling: SiblingPerson; pending: boolean }
  | { kind: "request"; sibling: SiblingPerson | null; father: string | null }

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
  const [flow, setFlow] = useState<Flow | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)
  const [answered, setAnswered] = useState(false)
  const [pending, startTransition] = useTransition()
  const refreshed = useRefreshed(onChanged)
  const errorId = useId()
  const first = firstOf(studentName)

  function openFlow(next: Flow) {
    setFlow(next)
    setAnswered(false)
    setFlowOpen(true)
  }

  function handle(outcome: FatherOutcome) {
    switch (outcome.status) {
      case "refused":
        setError(outcome.message)
        return
      case "question":
        openFlow({ kind: "question", name: outcome.fatherFullName, sibling: outcome.sibling, holders: outcome.holders })
        return
      case "saved":
        setEditing(false)
        toast(outcome.message)
        refreshed()
        return
      case "different":
        setEditing(false)
        refreshed()
        openFlow({ kind: "different", father: outcome.father, sibling: outcome.sibling, sentence: outcome.sentence, moves: outcome.moves })
        return
      case "same-now":
        setEditing(false)
        refreshed()
        openFlow({ kind: "same-now", father: outcome.father, sibling: outcome.sibling, pending: outcome.pending })
        return
      case "ask-request":
        setEditing(false)
        refreshed()
        openFlow({ kind: "request", sibling: flow?.kind === "question" ? flow.sibling : compareWith, father: flow?.kind === "question" ? flow.name : father })
        return
    }
  }

  function send(name: string, answer: "typo-mine" | "typo-theirs" | "different" | null, siblingFather: string | null) {
    setError(null)
    startTransition(async () => {
      let outcome: FatherOutcome
      try {
        outcome = await saveFatherName(leadId, name, answer, siblingFather)
      } catch {
        outcome = { status: "refused", message: LOST }
      }
      handle(outcome)
    })
  }

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
    send(name, null, null)
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

      {flow?.kind === "question" && (
        <Sheet
          open={flowOpen}
          onOpenChange={(next) => {
            if (pending) return
            setFlowOpen(next)
            if (!next && !answered) toast("Nothing saved. The father’s name is as it was.")
          }}
          placement="side"
          title="One name, or two?"
          hint={`${studentName} · father’s name`}
          closeLabel="Close"
        >
          <div className="sg-col">
            <Compare
              a={{ label: `${first}’s father`, name: flow.name }}
              b={{ label: `${flow.sibling.firstName}’s father`, name: flow.sibling.father ?? "" }}
            />
            <p className="sg-lead">Is it one name with a typing mistake, or two different names?</p>
            <ChoiceTiles
              name={`${leadId}-typo`}
              legend={<span className="sr-only">One name, or two?</span>}
              options={[
                {
                  value: "typo-mine",
                  label: "A typing mistake",
                  description: `The right name is ${flow.name}. It is saved on ${[first, ...flow.holders].length > 1 ? `${[first, ...flow.holders].slice(0, -1).join(", ")} and ${[first, ...flow.holders].slice(-1)[0]}` : first}’s records.`,
                },
                {
                  value: "typo-theirs",
                  label: "A typing mistake",
                  description: `The right name is ${flow.sibling.father}. ${first}’s name stays as it was.`,
                },
                { value: "different", label: "Two different names", description: "Send a Sibling request to the Admissions Manager" },
              ]}
              value={null}
              onChange={(value) => {
                if (pending) return
                setAnswered(true)
                window.setTimeout(() => {
                  setFlowOpen(false)
                  send(flow.name, value as "typo-mine" | "typo-theirs" | "different", flow.sibling.father)
                }, PICK_MS)
              }}
            />
          </div>
        </Sheet>
      )}

      {flow?.kind === "different" && (
        <Sheet
          open={flowOpen}
          onOpenChange={setFlowOpen}
          placement="side"
          title="The fathers’ names don’t match now"
          hint={`${studentName} · father’s name saved`}
          closeLabel="Close"
          foot={
            <>
              <Button size="wide" chevron onClick={() => setFlow({ kind: "request", sibling: flow.sibling, father: flow.father })}>
                Request the Sibling discount
              </Button>
              <Button variant="ghost" size="wide" onClick={() => setFlowOpen(false)}>
                Not now
              </Button>
            </>
          }
        >
          <div className="sg-col">
            {flow.sibling && (
              <Compare
                a={{ label: `${first}’s father`, name: flow.father }}
                b={{ label: `${flow.sibling.firstName}’s father`, name: flow.sibling.father ?? "" }}
              />
            )}
            {flow.sentence && <Note tone="wait">{flow.sentence}</Note>}
            {flow.moves.length > 0 && (
              <Note>
                <b>Fees that changed</b>
                {flow.moves.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </Note>
            )}
          </div>
        </Sheet>
      )}

      {flow?.kind === "same-now" && (
        <Sheet
          open={flowOpen}
          onOpenChange={setFlowOpen}
          placement="side"
          title="The fathers’ names match now"
          hint={`${studentName} · father’s name saved`}
          closeLabel="Close"
          foot={
            flow.pending ? (
              <Button size="wide" onClick={() => setFlowOpen(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button size="wide" chevron onClick={() => setFlow({ kind: "request", sibling: flow.sibling, father: flow.father })}>
                  Request the Sibling discount
                </Button>
                <Button variant="ghost" size="wide" onClick={() => setFlowOpen(false)}>
                  Not now
                </Button>
              </>
            )
          }
        >
          <div className="sg-col">
            <Compare
              a={{ label: `${first}’s father`, name: flow.father }}
              b={{ label: `${flow.sibling.firstName}’s father`, name: flow.sibling.father ?? "" }}
            />
            <Note>
              {flow.pending
                ? "The Sibling request stays open. The Admissions Manager decides."
                : "A name changed from a different one still needs the Admissions Manager’s decision."}
            </Note>
          </div>
        </Sheet>
      )}

      {flow?.kind === "request" && (
        <SiblingRequestSheet
          open={flowOpen}
          onOpenChange={setFlowOpen}
          leadId={leadId}
          studentName={studentName}
          father={flow.father}
          sibling={flow.sibling}
          enrolled={enrolled}
          onSent={refreshed}
        />
      )}
    </div>
  )
}

const schoolLine = (school: Extract<LeadPreviousSchool, { kind: "school" }>) =>
  `${school.name} · ${school.type === "private" ? "Private" : "Public"} · ${school.region}`

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
    if (n.length < 3) return setError("Type the school’s name.")
    if (!type || !region) return setError("Choose private or public, and the region.")
    save({ kind: "school", name: n, type, region }, "Previous school saved.")
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
                setError(null)
              }}
            />
          ) : (
            <p className="lr-hint">No region by that name.</p>
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
