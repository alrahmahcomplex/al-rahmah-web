"use client"

import { useId, useState, useTransition } from "react"

import { Icon } from "@/components/icons"
import { Button, ChoiceTiles, Disclosure, FieldError, NamedField, Note, Sheet, Tag, toast } from "@/components/kit"
import type { LeadClass } from "@/lib/services/leads"
import { streamName, STREAM_TAKES, type Stream, type StreamTakes } from "@/lib/services/streams"

import "./seats.css"

import { bringUpAction, changeStreamAction, deleteStreamAction, openStreamAction, requestStreamAction, type ChangeOutcome } from "./stream-actions"
import {
  clashingStream,
  labelsClash,
  movingGender,
  NEW_STREAM,
  nextLabel,
  placeholderSeats,
  previewTakes,
  seatsSoNobodyWaits,
  suggestedLabel,
  type BringUpRow,
  type SeatChild,
  type TakesExtra,
  type TakesPlan,
  type TakesPreview,
} from "./stream-rules"

// The Seats screen's sheets and buttons once streams are on (#449,
// prototype v42). Words are v42's.

const LOST = "The change could not be saved just now. Try again in a moment."

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
  const [name, setName] = useState(() => suggestedLabel(streams, need))
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
      setName(suggestedLabel(streams, need))
      setSeats("")
      setProblem(null)
      setRequestId(crypto.randomUUID())
    }
  }

  function pickTakes(value: string) {
    const picked = value as StreamTakes
    setTakes(picked)
    setName(suggestedLabel(streams, picked))
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const clean = name.trim()
    const count = Number(seats)
    const clash = clashingStream(streams, clean, takes)
    if (clash) return setProblem(clashText(className, clash, clean, nextLabel(streams, takes)))
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

  const typed = name.trim()
  const clash = clashingStream(streams, typed, takes)
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
            legend={<span className="st-q">Who does it take?</span>}
            layout="three"
            big
            options={STREAM_TAKES.map((value) => ({ value, label: value }))}
            value={takes}
            onChange={pickTakes}
          />
          <div className="st-field">
            <NamedField
              id={`${id}-label`}
              name="Label"
              icon="tag"
              value={name}
              maxLength={20}
              autoComplete="off"
              placeholder={labelPlaceholder(streams, takes)}
              invalid={clash !== null}
              aria-describedby={clash ? `${id}-label-error` : `${id}-label-hint`}
              onChange={(e) => setName(e.target.value)}
            />
            {clash ? (
              <FieldError id={`${id}-label-error`} alignStart message={clashText(className, clash, typed, nextLabel(streams, takes))} />
            ) : (
              <p id={`${id}-label-hint`} className="st-hint">
                {labelHint(className, typed, takes, streams)}
              </p>
            )}
          </div>
          <div className="st-field">
            <NamedField
              id={`${id}-seats`}
              name="Seats"
              icon="seats"
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

/** The pencil on a stream: change who it takes, its label or its seats (owner 2026-11-26, prototype v4). */
export function ChangeStreamButton({
  year,
  className,
  stream,
  streams,
  placed,
  waiting,
}: {
  year: number
  className: LeadClass
  stream: Stream
  // The class's streams, the children placed in them and the children waiting for one.
  streams: Stream[]
  placed: (SeatChild & { streamId: string })[]
  waiting: SeatChild[]
}) {
  const [open, setOpen] = useState(false)
  const [takes, setTakes] = useState<StreamTakes>(stream.takes)
  const [name, setName] = useState(stream.label)
  const [seats, setSeats] = useState(String(stream.seats))
  // Where the children who must move go: "open", "raise:<stream id>" or "wait".
  const [pick, setPick] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState("")
  const [newSeats, setNewSeats] = useState("")
  const [raiseSeats, setRaiseSeats] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  // The delete step: asked once more before the stream goes for good.
  const [deleting, setDeleting] = useState(false)
  const [pending, startTransition] = useTransition()
  const id = useId()
  const full = streamName(className, stream.label, stream.takes)
  const others = streams.filter((s) => s.id !== stream.id)

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (next) {
      setTakes(stream.takes)
      setName(stream.label)
      setSeats(String(stream.seats))
      setPick(null)
      setNewLabel("")
      setNewSeats("")
      setRaiseSeats({})
      setProblem(null)
      setRequestId(crypto.randomUUID())
      setDeleting(false)
    }
  }

  const changed = takes !== stream.takes
  const label = name.trim()
  const seatCount = isCount(seats) ? Number(seats) : stream.seats
  const plan: TakesPlan = { streams, placed, waiting, change: { streamId: stream.id, takes, seats: seatCount } }
  const base = previewTakes(plan)
  // With who it takes unchanged everyone stays; the count is the stream’s own, which needs no list of children.
  const staying = changed ? base.staying : stream.placed
  const n = base.leaving.length
  const gender = movingGender(base.leaving)
  const word = movingWord(gender, n)
  const needTakes: StreamTakes = gender === "Girl" ? "Girls" : gender === "Boy" ? "Boys" : "Mixed"
  const mustChoose = changed && n > 0 && base.stranded > 0
  const after = streams.map((s) => (s.id === stream.id ? { ...s, takes, label } : s))
  const suggested = suggestedLabel(after, needTakes)
  const shownNew = pick === "open" ? newLabel.trim() : suggested
  // Streams that take at least one of the children moving, for "Add seats to".
  const raisable = others.filter((s) => base.leaving.some((m) => takesChild(s.takes, m.child.gender))).toSorted((a, b) => a.position - b.position)

  const extra: TakesExtra | null =
    !mustChoose || pick === null || pick === "wait"
      ? null
      : pick === "open"
        ? { kind: "open", takes: needTakes, label: shownNew, seats: isCount(newSeats) ? Number(newSeats) : 0 }
        : { kind: "raise", streamId: pick.slice(6), seats: isCount(raiseSeats[pick.slice(6)] ?? "") ? Number(raiseSeats[pick.slice(6)]) : (others.find((s) => s.id === pick.slice(6))?.seats ?? 0) }
  const preview = extra ? previewTakes({ ...plan, extra }) : base
  const least = extra ? seatsSoNobodyWaits({ ...plan, extra }) : null
  const ahead = waiting.filter((w) => takesChild(needTakes, w.gender)).length
  const why = `the ${n} ${word} moving${ahead ? ` and the ${ahead} already waiting, who go first` : ""}`
  const nameOf = (streamId: string | null) => {
    if (streamId === NEW_STREAM) return streamName(className, shownNew, needTakes)
    const s = after.find((each) => each.id === streamId)
    return s ? streamName(className, s.label, s.takes) : ""
  }
  const labelClash = clashingStream(others, label, takes)
  const newClash = clashingStream(after, newLabel.trim(), needTakes)
  const raising = pick?.startsWith("raise:") ? others.find((s) => s.id === pick.slice(6)) : undefined

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const issue = (() => {
      if (labelClash) return clashText(className, labelClash, label, nextLabel(others, takes))
      if (!isCount(seats)) return "Type the number of seats."
      if (Number(seats) < staying)
        return `${staying} ${staying === 1 ? "child stays" : "children stay"} in ${plainName(className, label)}, so the seats can’t go below ${staying}.`
      if (!mustChoose) return null
      if (pick === null) return `Choose where the ${n} ${word} go.`
      if (pick === "open") {
        if (newClash) return `New stream: ${clashText(className, newClash, newLabel.trim(), nextLabel(after, needTakes))}`
        if (!isCount(newSeats) || Number(newSeats) < 1) return "Type the seats for the new stream, 1 or more."
      }
      if (raising) {
        const typed = raiseSeats[raising.id] ?? String(raising.seats)
        if (!isCount(typed)) return "Type the number of seats."
        if (Number(typed) < raising.placed)
          return `${streamName(className, raising.label, raising.takes)} has ${raising.placed} ${raising.placed === 1 ? "child" : "children"} placed. The seats can’t go below ${raising.placed}.`
      }
      return null
    })()
    if (issue) return setProblem(issue)
    setProblem(null)
    const savedName = streamName(className, label, takes)
    startTransition(async () => {
      let outcome: ChangeOutcome
      try {
        outcome = await changeStreamAction({
          streamId: stream.id,
          label,
          seats: Number(seats),
          takes,
          name: savedName,
          raiseName: raising ? streamName(className, raising.label, raising.takes) : undefined,
          open: mustChoose && pick === "open" ? { takes: needTakes, label: newLabel.trim(), seats: Number(newSeats), requestId } : undefined,
          raise: mustChoose && raising ? { streamId: raising.id, seats: Number(raiseSeats[raising.id] ?? raising.seats) } : undefined,
        })
      } catch {
        outcome = { status: "refused", message: LOST }
      }
      if (outcome.status === "refused") return setProblem(outcome.message)
      setOpen(false)
      toast(changeMessage(className, outcome, { streams: after, before: stream, gender }))
    })
  }

  function remove() {
    startTransition(async () => {
      let outcome
      try {
        outcome = await deleteStreamAction({ streamId: stream.id, name: full })
      } catch {
        outcome = { status: "refused" as const, message: LOST }
      }
      if (outcome.status === "refused") {
        setDeleting(false)
        return setProblem(outcome.message)
      }
      setOpen(false)
      toast(outcome.message)
    })
  }

  const later = streams.filter((s) => s.position > stream.position).length

  const foot = !(changed && n > 0)
    ? "Save the changes"
    : preview.stranded === n
      ? `Save: ${n} ${word} will wait`
      : preview.stranded > 0
        ? `Save: ${n - preview.stranded} move, ${preview.stranded} wait`
        : `Save and move ${n} ${word}`

  return (
    <>
      <button type="button" className="st-edit" aria-label={`Change ${full}`} onClick={() => changeOpen(true)}>
        <Icon name="pen" size={16} />
      </button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={deleting ? `Delete ${full}?` : `Change ${full}`}
        hint={`${className} · Enrollment year ${year} · position ${stream.position} of ${streams.length}`}
        closeLabel="Close"
        foot={
          deleting ? (
            <div className="st-confirm">
              <Button variant="bad" size="wide" pending={pending} onClick={remove}>
                {pending ? "Deleting…" : `Yes, delete ${full}`}
              </Button>
              <Button variant="ghost" size="wide" disabled={pending} onClick={() => setDeleting(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button type="submit" form={`${id}-form`} size="wide" disabled={pending}>
              {pending ? "Saving…" : foot}
            </Button>
          )
        }
      >
        {deleting ? (
          <div className="st-form">
            <Note tone="bad">
              {full} goes for good: its label, who it takes and its {stream.seats} {stream.seats === 1 ? "seat" : "seats"}. This can’t be undone. Nobody is
              placed in it.
            </Note>
            {later > 0 && (
              <p className="st-hint">
                The {later === 1 ? "stream" : `${later} streams`} after it {later === 1 ? "moves" : "move"} up one place.
              </p>
            )}
          </div>
        ) : (
        <form id={`${id}-form`} className="st-form" onSubmit={submit} noValidate>
          <ChoiceTiles
            name={`${id}-takes`}
            legend={<span className="st-q">Who does it take?</span>}
            layout="three"
            big
            options={STREAM_TAKES.map((value) => ({ value, label: value }))}
            value={takes}
            onChange={(value) => {
              setTakes(value as StreamTakes)
              setPick(null)
              setProblem(null)
            }}
          />
          <div className="st-field">
            <NamedField
              id={`${id}-label`}
              name="Label"
              icon="tag"
              value={name}
              maxLength={20}
              autoComplete="off"
              placeholder={labelPlaceholder(others, takes)}
              invalid={labelClash !== null}
              aria-describedby={labelClash ? `${id}-label-error` : `${id}-label-hint`}
              onChange={(e) => setName(e.target.value)}
            />
            {labelClash ? (
              <FieldError
                id={`${id}-label-error`}
                alignStart
                message={clashText(className, labelClash, label, nextLabel(others, takes))}
              />
            ) : (
              <p id={`${id}-label-hint`} className="st-hint">
                {labelHint(className, label, takes, others)}
              </p>
            )}
          </div>
          <div className="st-field">
            <NamedField
              id={`${id}-seats`}
              name="Seats"
              icon="seats"
              inputMode="numeric"
              value={seats}
              autoComplete="off"
              placeholder="For example 40"
              aria-describedby={`${id}-seats-hint`}
              onChange={(e) => setSeats(e.target.value)}
            />
            <p id={`${id}-seats-hint`} className="st-hint">
              Places for new students.{" "}
              {staying
                ? `${staying} ${staying === 1 ? "child stays" : "children stay"} in it, so the seats can’t go below ${staying}.`
                : "Nobody stays placed in it."}{" "}
              Raising the seats places children who are waiting.
            </p>
          </div>

          {changed && (
            <div className="st-out">
              {stream.placed === 0 && n === 0 ? (
                <Note>Nobody is placed in {plainName(className, stream.label)} yet, so nobody moves.</Note>
              ) : n === 0 ? (
                <Note tone="good">
                  Nobody moves: every child in {plainName(className, stream.label)} can stay in a stream that takes {takesWord(takes)}.
                </Note>
              ) : (
                <>
                  <div>
                    <h3 className="kit-sec-title">
                      {n} {word} {n === 1 ? "has" : "have"} to move
                    </h3>
                    <p className="st-hint">
                      A {takes.toLowerCase()} stream can’t keep the {word} placed in {plainName(className, stream.label)}. They take seats in the first {className} stream, in
                      order, that takes them and has room.
                    </p>
                  </div>
                  {!mustChoose ? (
                    <Note tone="good">{whereTheyGo(base.leaving, nameOf, streams)}</Note>
                  ) : (
                    <>
                      <Note tone="wait">
                        {raisable.length
                          ? `${raisable.map((s) => streamName(className, s.label, s.takes)).join(" and ")} ${raisable.length === 1 ? "doesn’t" : "don’t"} have room for all ${n}`
                          : `No other ${className} stream takes ${word}`}
                        {ahead ? `, and ${ahead} already waiting for a ${className} seat go first` : ""}. Choose where they go before saving.
                      </Note>
                      <ChoiceTiles
                        name={`${id}-where`}
                        legend={<span className="st-q">Where do the {word} go?</span>}
                        options={[
                          {
                            value: "open",
                            label: `Open a new stream for ${word}`,
                            description: `${streamName(className, shownNew, needTakes)}, after the streams already open`,
                          },
                          ...raisable.map((s) => {
                            const free = s.seats - s.placed
                            return {
                              value: `raise:${s.id}`,
                              label: `Add seats to ${streamName(className, s.label, s.takes)}`,
                              description: `${free > 0 ? free : "No"} free ${free === 1 ? "seat" : "seats"} now`,
                            }
                          }),
                          { value: "wait", label: "Let them wait", description: "They go to Waiting for a stream and take the first seat that frees" },
                        ]}
                        value={pick}
                        onChange={(value) => {
                          setPick(value)
                          setProblem(null)
                          if (value === "open" && !newLabel) setNewLabel(suggested)
                        }}
                      />
                      {pick === "open" && (
                        <div className="kit-inline">
                          <h3 className="kit-sec-title">The new stream</h3>
                          <div className="st-field">
                            <NamedField
                              id={`${id}-new-label`}
                              name="Label"
                              icon="tag"
                              value={newLabel}
                              maxLength={20}
                              autoComplete="off"
                              placeholder={labelPlaceholder(after, needTakes)}
                              invalid={newClash !== null}
                              aria-describedby={newClash ? `${id}-new-label-error` : `${id}-new-label-hint`}
                              onChange={(e) => setNewLabel(e.target.value)}
                            />
                            {newClash ? (
                              <FieldError
                                id={`${id}-new-label-error`}
                                alignStart
                                message={clashText(className, newClash, newLabel.trim(), nextLabel(after, needTakes))}
                              />
                            ) : (
                              <p id={`${id}-new-label-hint`} className="st-hint">
                                {labelHint(className, newLabel.trim(), needTakes, after)} It takes {takesWord(needTakes)} and comes last in the order.
                              </p>
                            )}
                          </div>
                          <div className="st-field">
                            <NamedField
                              id={`${id}-new-seats`}
                              name="Seats"
                              icon="seats"
                              inputMode="numeric"
                              value={newSeats}
                              autoComplete="off"
                              placeholder={least === null ? undefined : String(least)}
                              aria-describedby={`${id}-new-seats-hint`}
                              onChange={(e) => setNewSeats(e.target.value)}
                            />
                            <p id={`${id}-new-seats-hint`} className="st-hint">
                              {least === null ? "Places for new students." : `${least} or more so nobody waits: ${why}.`}
                            </p>
                          </div>
                        </div>
                      )}
                      {raising && (
                        <div className="kit-inline">
                          <h3 className="kit-sec-title">{streamName(className, raising.label, raising.takes)}</h3>
                          <div className="st-field">
                            <NamedField
                              id={`${id}-raise-seats`}
                              name="Seats"
                              icon="seats"
                              inputMode="numeric"
                              value={raiseSeats[raising.id] ?? String(raising.seats)}
                              autoComplete="off"
                              aria-describedby={`${id}-raise-seats-hint`}
                              onChange={(e) => setRaiseSeats((was) => ({ ...was, [raising.id]: e.target.value }))}
                            />
                            <p id={`${id}-raise-seats-hint`} className="st-hint">
                              Now {raising.seats}, with {raising.placed} placed.
                              {least === null ? "" : ` ${least} or more so nobody waits: room for ${why}.`}
                            </p>
                          </div>
                        </div>
                      )}
                      {pick !== null && preview.stranded > 0 && (
                        <Note tone="wait">
                          {preview.stranded} {movingWord(gender, preview.stranded)} will have no seat. They go to Waiting for a stream and take the first seat that
                          frees, in their order.
                        </Note>
                      )}
                    </>
                  )}
                </>
              )}
              {preview.fromWaiting.length > 0 && <Note>{seatedText(preview.fromWaiting, stream.id, className, label, nameOf, n > 0 ? word : null)}</Note>}
              {n > 0 && (
                <Disclosure label={`See the ${n} ${word} and where they go`}>
                  <ol className="st-moves">
                    {preview.leaving.map(({ child, to }) => (
                      <li key={child.leadId}>
                        <span className="st-no">{child.rank ?? "–"}.</span>
                        <span className="st-name">{child.studentName}</span>
                        <span className="st-dest" data-none={to === null || undefined}>
                          {to === null ? (
                            "No seat yet"
                          ) : (
                            <>
                              <Icon name="right" size={16} />
                              {nameOf(to)}
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Disclosure>
              )}
            </div>
          )}
          {problem && (
            <Note tone="bad" role="alert">
              {problem}
            </Note>
          )}
          <div className="st-del">
            {stream.placed === 0 ? (
              <Button
                variant="bad"
                size="small"
                onClick={() => {
                  setProblem(null)
                  setDeleting(true)
                }}
              >
                Delete this stream
              </Button>
            ) : (
              <p className="st-hint">
                Only an empty stream can be deleted. {stream.placed} {stream.placed === 1 ? "child is" : "children are"} placed in {full}.
              </p>
            )}
          </div>
        </form>
        )}
      </Sheet>
    </>
  )
}

const isCount = (value: string) => /^\d+$/.test(value.trim())

/** A stream's name without who it takes: "STD 1 B", or the class alone with no label. */
const plainName = (className: LeadClass, label: string) => (label ? `${className} ${label}` : className)

/** Why a label can't be used: another stream has it, or (an empty label) another already has none. */
function clashText(className: LeadClass, clash: { label: string; takes: StreamTakes }, label: string, next: string): string {
  return label === ""
    ? `${streamName(className, "", clash.takes)} already has no label, so this stream needs one, for example ${next}.`
    : `${streamName(className, clash.label, clash.takes)} already has the label ${clash.label}. Choose another label, for example ${next}.`
}

/** The hint under a label box: how the stream will be shown. */
function labelHint(className: LeadClass, label: string, takes: StreamTakes, others: readonly { label: string; takes: StreamTakes }[]): string {
  if (label) return `Shown as “${streamName(className, label, takes)}”.`
  return others.some((s) => labelsClash(s.takes, takes))
    ? `No label: shown as “${streamName(className, "", takes)}”. You may type one.`
    : `No label: shown as “${streamName(className, "", takes)}”, as the only ${className} stream${takes === "Mixed" ? "" : ` for ${takes.toLowerCase()}`}. You may type one.`
}

/** "None" while the stream may go without a label; otherwise an example letter. */
const labelPlaceholder = (others: readonly { label: string; takes: StreamTakes }[], takes: StreamTakes) =>
  clashingStream(others, "", takes) ? `For example ${nextLabel(others, takes)}` : "None"
const takesWord = (takes: StreamTakes) => (takes === "Mixed" ? "boys and girls" : takes.toLowerCase())
const takesChild = (takes: StreamTakes, gender: SeatChild["gender"]) =>
  takes === "Mixed" || (takes === "Boys" && gender === "Boy") || (takes === "Girls" && gender === "Girl")

/** "girls", "boy", or "children" when the children moving differ or one has no Boy or girl answer. */
function movingWord(gender: SeatChild["gender"], n: number): string {
  if (gender === "Girl") return n === 1 ? "girl" : "girls"
  if (gender === "Boy") return n === 1 ? "boy" : "boys"
  return n === 1 ? "child" : "children"
}

/** Where the children moving go when there is room for all of them. */
function whereTheyGo(leaving: TakesPreview["leaving"], nameOf: (id: string | null) => string, streams: Stream[]): string {
  const counts = new Map<string, number>()
  for (const m of leaving) if (m.to) counts.set(m.to, (counts.get(m.to) ?? 0) + 1)
  if (counts.size > 1) return `They move: ${[...counts].map(([to, c]) => `${c} to ${nameOf(to)}`).join(", ")}.`
  const [to] = [...counts.keys()]
  const target = streams.find((s) => s.id === to)
  const free = target ? target.seats - target.placed : 0
  const who = leaving.length === 1 ? `${leaving[0].child.studentName} moves` : `All ${leaving.length} move`
  return `${who} to ${nameOf(to)}. It has ${free} free ${free === 1 ? "seat" : "seats"}, so nothing else is needed.`
}

/** The waiting children who take a seat with the change. */
function seatedText(
  seated: TakesPreview["fromWaiting"],
  streamId: string,
  className: LeadClass,
  label: string,
  nameOf: (id: string | null) => string,
  leavingWord: string | null,
): string {
  const here = seated.filter((m) => m.to === streamId)
  const elsewhere = seated.filter((m) => m.to !== streamId)
  const parts: string[] = []
  if (here.length) {
    const boys = here.filter((m) => m.child.gender === "Boy").length
    const girls = here.filter((m) => m.child.gender === "Girl").length
    const rest = here.length - boys - girls
    const who = [boys && `${boys} ${movingWord("Boy", boys)}`, girls && `${girls} ${movingWord("Girl", girls)}`, rest && `${rest} ${movingWord(null, rest)}`].filter(Boolean).join(" and ")
    parts.push(
      `${who} waiting for a ${className} seat ${here.length === 1 ? "takes a place" : "take places"} in ${plainName(className, label)}${leavingWord ? ` in the places the ${leavingWord} leave` : ""}`,
    )
  }
  if (elsewhere.length) {
    const c = elsewhere.length
    parts.push(`${c} ${c === 1 ? "child" : "children"} waiting ${c === 1 ? "takes a place" : "take places"} in ${[...new Set(elsewhere.map((m) => nameOf(m.to)))].join(" and ")}`)
  }
  return `${parts.join(". ")}.`
}

/** The toast after a saved change. */
function changeMessage(
  className: LeadClass,
  outcome: Extract<ChangeOutcome, { status: "done" }>,
  context: { streams: Stream[]; before: Stream; gender: SeatChild["gender"] },
): string {
  const saved = outcome.stream
  const name = streamName(className, saved.label, saved.takes)
  const nameOf = (id: string) => {
    if (outcome.opened?.id === id) return streamName(className, outcome.opened.label, outcome.opened.takes)
    const s = context.streams.find((each) => each.id === id)
    return s ? streamName(className, s.label, s.takes) : "another stream"
  }
  const parts = [saved.takes !== context.before.takes ? `${name} now takes ${takesWord(saved.takes)}.` : `${name} saved: ${saved.seats} seats.`]
  const counts = new Map<string, number>()
  let left = 0
  for (const m of outcome.moved) {
    if (m.streamId) counts.set(m.streamId, (counts.get(m.streamId) ?? 0) + 1)
    else left++
  }
  if (counts.size) parts.push(`${[...counts].map(([to, c]) => `${c} ${movingWord(context.gender, c)} moved to ${nameOf(to)}`).join(", ")}.`)
  if (left) parts.push(`${left} ${movingWord(context.gender, left)} ${left === 1 ? "is" : "are"} waiting for a stream.`)
  if (outcome.opened) parts.push(`${nameOf(outcome.opened.id)} is open.`)
  const w = outcome.seatedFromWaiting
  if (w) parts.push(`${w} waiting ${w === 1 ? "child took a seat" : "children took seats"}.`)
  return parts.join(" ")
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
                    {row.source.label ? `${streamName(row.toClass, row.source.label, row.source.takes)} is taken` : `${row.toClass} already has a stream with no label`} in {year}, so it comes up as {streamName(row.toClass, row.label, row.source.takes)}.
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
