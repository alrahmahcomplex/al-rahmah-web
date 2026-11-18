"use client"

import { useId, useState, useTransition } from "react"

import { Icon } from "@/components/icons"
import { Button, ChoiceTiles, Field, Note, Sheet, Tag, toast } from "@/components/kit"
import type { LeadClass } from "@/lib/services/leads"
import { streamName, STREAM_TAKES, type Stream, type StreamTakes } from "@/lib/services/streams"

import "./seats.css"

import { bringUpAction, editStreamAction, openStreamAction, requestStreamAction } from "./stream-actions"
import { clashingStream, nextLabel, placeholderSeats, type BringUpRow } from "./stream-rules"

// The Seats screen's sheets and buttons once streams are on (#449,
// prototype v42). Words are v42's.

const LOST = "The change could not be saved just now. Try again in a moment."
const takesLabel = (takes: StreamTakes) => (takes === "Mixed" ? "any child" : takes.toLowerCase())

export function TakesTag({ takes }: { takes: StreamTakes }) {
  return (
    <Tag tone="line" className={`st-takes st-takes-${takes.toLowerCase()}`}>
      {takes}
    </Tag>
  )
}

/** "Add a stream" on a class card, or "Open a new FORM 1 stream" in a notice. */
export function OpenStreamButton({
  year,
  className,
  streams,
  need = "Mixed",
  label,
  variant = "ghost",
  size = "small",
  forChild,
}: {
  year: number
  className: LeadClass
  streams: Stream[]
  need?: StreamTakes
  label: string
  variant?: "go" | "ghost"
  size?: "small" | "wide"
  // Opened from a child’s Record payment: when the database says their
  // payment can now go through, the toast says so (v42).
  forChild?: { leadId: string; studentName: string }
}) {
  const [open, setOpen] = useState(false)
  const [takes, setTakes] = useState<StreamTakes>(need)
  const [name, setName] = useState(() => nextLabel(streams, need))
  const [seats, setSeats] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [pending, startTransition] = useTransition()
  const id = useId()
  const faint = placeholderSeats(streams)

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (next) {
      setTakes(need)
      setName(nextLabel(streams, need))
      setSeats("")
      setProblem(null)
      setRequestId(crypto.randomUUID())
    }
  }

  function pickTakes(value: string) {
    const picked = value as StreamTakes
    setTakes(picked)
    setName(nextLabel(streams, picked))
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const clean = name.trim()
    const count = Number(seats)
    if (!clean) return setProblem("Type a label, for example C.")
    const clash = clashingStream(streams, clean, takes)
    if (clash) return setProblem(`${streamName(className, clash.label, clash.takes)} already has the label ${clash.label}. Choose another label.`)
    if (!/^\d+$/.test(seats.trim()) || count < 1) return setProblem("Type the number of seats, 1 or more.")
    setProblem(null)
    startTransition(async () => {
      let outcome
      try {
        outcome = await openStreamAction({
          year,
          className,
          label: clean,
          takes,
          seats: count,
          requestId,
          name: streamName(className, clean, takes),
          forLeadId: forChild?.leadId,
        })
      } catch {
        outcome = { status: "refused" as const, message: LOST }
      }
      if (outcome.status === "refused") return setProblem(outcome.message)
      setOpen(false)
      const name = streamName(className, clean, takes)
      toast(forChild && outcome.childCanPay ? `${name} is open. ${forChild.studentName}’s payment can go ahead.` : outcome.message)
    })
  }

  const shown = `${className} ${name.trim() || "…"}${takes === "Mixed" ? "" : ` (${takes})`}`
  return (
    <>
      <Button size={size} variant={variant} icon={variant === "ghost" ? "plus" : undefined} onClick={() => changeOpen(true)}>
        {label}
      </Button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`Open a new ${className} stream`}
        hint={`${className} · Enrollment year ${year}`}
        closeLabel="Close"
        foot={
          <Button type="submit" form={`${id}-form`} size="wide" disabled={pending}>
            {pending ? "Saving…" : "Open the stream"}
          </Button>
        }
      >
        <form id={`${id}-form`} className="st-form" onSubmit={submit} noValidate>
          <ChoiceTiles
            name={`${id}-takes`}
            legend={<span className="st-label">Who does it take?</span>}
            layout="three"
            big
            options={STREAM_TAKES.map((value) => ({ value, label: value }))}
            value={takes}
            onChange={pickTakes}
          />
          <div className="st-field">
            <label htmlFor={`${id}-label`} className="st-label">
              Label
            </label>
            <Field
              id={`${id}-label`}
              value={name}
              maxLength={20}
              autoComplete="off"
              aria-describedby={`${id}-label-hint`}
              onChange={(e) => setName(e.target.value)}
            />
            <p id={`${id}-label-hint`} className="st-hint">
              Shown as “{shown}”. Suggested: the first free letter for {takesLabel(takes)}.
            </p>
          </div>
          <div className="st-field">
            <label htmlFor={`${id}-seats`} className="st-label">
              Seats for new students
            </label>
            <Field
              id={`${id}-seats`}
              inputMode="numeric"
              value={seats}
              placeholder={faint === null ? undefined : String(faint)}
              autoComplete="off"
              aria-describedby={`${id}-seats-hint`}
              onChange={(e) => setSeats(e.target.value)}
            />
            <p id={`${id}-seats-hint`} className="st-hint">
              {faint === null
                ? `No ${className} stream in ${year} has places yet, so there is nothing to suggest. Type the places this stream offers new students.`
                : `The faint number is the seats of the last ${className} stream opened with places (${faint}). Type the places this stream offers new students.`}
            </p>
          </div>
          <p className="st-hint">Children fill the streams of {className} in order. This one comes after the streams already open.</p>
          {problem && (
            <Note tone="bad" role="alert">
              {problem}
            </Note>
          )}
        </form>
      </Sheet>
    </>
  )
}

/** The pencil on a stream: change its label or seats. */
export function EditStreamButton({ year, className, stream, of }: { year: number; className: LeadClass; stream: Stream; of: number }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(stream.label)
  const [seats, setSeats] = useState(String(stream.seats))
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const id = useId()
  const full = streamName(className, stream.label, stream.takes)

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (next) {
      setName(stream.label)
      setSeats(String(stream.seats))
      setProblem(null)
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const clean = name.trim()
    if (!clean) return setProblem("Type a label, for example A.")
    if (!/^\d+$/.test(seats.trim())) return setProblem("Type the number of seats.")
    const count = Number(seats)
    if (count < stream.placed)
      return setProblem(`${full} has ${stream.placed} ${stream.placed === 1 ? "child" : "children"} placed. The seats can’t go below ${stream.placed}.`)
    setProblem(null)
    startTransition(async () => {
      let outcome
      try {
        outcome = await editStreamAction({
          streamId: stream.id,
          label: clean,
          seats: count,
          name: streamName(className, clean, stream.takes),
          placed: stream.placed,
        })
      } catch {
        outcome = { status: "refused" as const, message: LOST }
      }
      if (outcome.status === "refused") return setProblem(outcome.message)
      setOpen(false)
      toast(outcome.message)
    })
  }

  return (
    <>
      <button type="button" className="st-edit" aria-label={`Change ${full}`} onClick={() => changeOpen(true)}>
        <Icon name="pen" size={16} />
      </button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`Change ${full}`}
        hint={`${className} · Enrollment year ${year}`}
        closeLabel="Close"
        foot={
          <Button type="submit" form={`${id}-form`} size="wide" disabled={pending}>
            {pending ? "Saving…" : "Save the changes"}
          </Button>
        }
      >
        <form id={`${id}-form`} className="st-form" onSubmit={submit} noValidate>
          <div className="st-field">
            <label htmlFor={`${id}-label`} className="st-label">
              Label
            </label>
            <Field id={`${id}-label`} value={name} maxLength={20} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="st-field">
            <label htmlFor={`${id}-seats`} className="st-label">
              Seats for new students
            </label>
            <Field
              id={`${id}-seats`}
              inputMode="numeric"
              value={seats}
              autoComplete="off"
              aria-describedby={`${id}-seats-hint`}
              onChange={(e) => setSeats(e.target.value)}
            />
            <p id={`${id}-seats-hint`} className="st-hint">
              {stream.placed
                ? `${stream.placed} ${stream.placed === 1 ? "child is" : "children are"} placed in it, so the seats can’t go below ${stream.placed}.`
                : "Nobody is placed in it yet."}{" "}
              Raising the seats places children who are waiting.
            </p>
          </div>
          <div className="st-field">
            <span className="st-label">Who it takes</span>
            <p className="st-hint">
              {stream.takes} · position {stream.position} of {of}. These don’t change.
            </p>
          </div>
          {problem && (
            <Note tone="bad" role="alert">
              {problem}
            </Note>
          )}
        </form>
      </Sheet>
    </>
  )
}

/** "Bring up 2027’s streams": the list to check, then one save. */
export function BringUpButton({ year, rows }: { year: number; rows: BringUpRow[] }) {
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const previous = year - 1
  const n = rows.length

  function save() {
    setProblem(null)
    startTransition(async () => {
      let outcome
      try {
        outcome = await bringUpAction({
          year,
          sources: rows.map((row) => row.source.id),
        })
      } catch {
        outcome = { status: "refused" as const, message: LOST }
      }
      if (outcome.status === "refused") return setProblem(outcome.message)
      setOpen(false)
      toast(outcome.message)
    })
  }

  return (
    <>
      <Button size="small" icon="up" onClick={() => setOpen(true)}>
        Bring up {previous}’s streams
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        title={`Bring up ${previous}’s streams`}
        hint={`Into ${year} · ${n} ${n === 1 ? "stream" : "streams"}`}
        closeLabel="Close"
        foot={
          <Button size="wide" onClick={save} disabled={pending || n === 0}>
            {pending ? "Saving…" : `Bring up ${n} ${n === 1 ? "stream" : "streams"}`}
          </Button>
        }
      >
        <div className="st-form">
          <p className="st-hint">
            Each stream moves up one class with the same label and who it takes, and <b>0 seats</b>. Type the places for each one after saving. Students don’t
            move.
          </p>
          <ol className="st-bring">
            {rows.map((row) => (
              <li key={row.source.id}>
                <span className="st-from">{streamName(row.source.className, row.source.label, row.source.takes)}</span>
                <Icon name="up" size={16} />
                <span className="st-to">{streamName(row.toClass, row.label, row.source.takes)}</span>
                <TakesTag takes={row.source.takes} />
                <span className="st-cap">0 seats</span>
                {row.renamed && (
                  <small className="st-renamed">
                    {row.toClass} {row.source.label} is taken in {year}, so it comes up as {row.toClass} {row.label}.
                  </small>
                )}
              </li>
            ))}
          </ol>
          <Note>FORM 4 streams don’t come up: there is no FORM 5. DAY CARE starts with no streams, so it has no limit until you add one.</Note>
          {problem && (
            <Note tone="bad" role="alert">
              {problem}
            </Note>
          )}
        </div>
      </Sheet>
    </>
  )
}

/** "Send a request to open a new stream", for a class and need, or for a child. */
export function RequestStreamButton({
  target,
  className,
  need,
  variant = "go",
  size = "small",
  alreadySent = false,
}: {
  target: { leadId: string } | { year: number; className: LeadClass; need: "Boys" | "Girls" | null }
  className: LeadClass
  need: "Boys" | "Girls" | null
  variant?: "go" | "ghost"
  size?: "small" | "wide"
  // A request for this is open already: the button shows Request sent.
  alreadySent?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [sent, setSent] = useState(alreadySent)

  function send() {
    startTransition(async () => {
      let outcome
      try {
        outcome = await requestStreamAction(target)
      } catch {
        outcome = { status: "refused" as const, message: LOST }
      }
      if (outcome.status === "refused") {
        toast(outcome.message)
        return
      }
      setSent(true)
      toast(`Request sent to the Admissions Manager: open a new ${className} stream${need ? ` for ${need.toLowerCase()}` : ""}.`)
    })
  }

  if (sent) {
    return (
      <Button size={size} variant="ghost" disabled>
        Request sent
      </Button>
    )
  }
  return (
    <Button size={size} variant={variant} onClick={send} disabled={pending}>
      Send a request to open a new stream
    </Button>
  )
}
