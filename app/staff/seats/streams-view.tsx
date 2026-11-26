import Link from "next/link"
import type { ReactNode } from "react"

import { Card, Note, PageHeader, Tag } from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"
import { SEAT_RELEASE_REASON } from "@/lib/services/lead-closure"
import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"
import { streamName, type ClassStreams, type PlacedChild, type Stream, type YearStreams } from "@/lib/services/streams"

import { declineHref } from "../applicants/decline-link"
import { BringUpButton, ChangeStreamButton, OpenStreamButton, RequestStreamButton, TakesTag } from "./stream-sheets"
import { bringUpPlan, seatNeeds, tanzaniaTime, type SeatNeed } from "./stream-rules"

// Seats once streams are on (#449, prototype v42): the notices, the children
// waiting for a stream, and a card per class with its streams. Words are
// v42's. The Manager (academic_years.manage) opens and changes streams;
// other staff who may view payments see the same and can ask for a stream.

export type Who = { manages: boolean; mayDecline: boolean }

/** "26 boys · 14 girls" under a stream’s name, with any child who has no Boy or girl answer. */
export function mixLine(stream: Stream): string {
  if (stream.boys === null || stream.girls === null) return ""
  const other = stream.placed - stream.boys - stream.girls
  return [
    stream.boys > 0 && `${stream.boys} ${stream.boys === 1 ? "boy" : "boys"}`,
    stream.girls > 0 && `${stream.girls} ${stream.girls === 1 ? "girl" : "girls"}`,
    other > 0 && `${other} with no Boy or girl answer`,
  ]
    .filter(Boolean)
    .join(" · ")
}

const needWord = (need: "Boys" | "Girls") => (need === "Boys" ? "boys" : "girls")

function NeedNotice({ need, year, classStreams, who }: { need: SeatNeed; year: number; classStreams: Stream[]; who: Who }) {
  // No full stream to name when no stream takes these children at all.
  const full = need.fullStream ? `${streamName(need.className, need.fullStream.label, need.fullStream.takes)} is full.` : null
  const asked = need.request
  if (who.manages) {
    const by = asked
      ? `${asked.requestedByName}${asked.requestedByRole ? ` (${asked.requestedByRole})` : ""} asked at ${tanzaniaTime(asked.requestedAt)}`
      : null
    // v42 names the child only when the request came from their page; the
    // child's need (from their Boy or girl answer) gives the pronoun.
    const childNeed = asked?.need === "Boys" || asked?.need === "Girls" ? asked.need : null
    const pronoun = childNeed === "Girls" ? { his: "her", him: "her" } : { his: "his", him: "him" }
    const askedBy =
      by &&
      (asked?.studentName && childNeed ? ` ${by}: ${asked.studentName} can’t pay ${pronoun.his} school fee until a stream takes ${pronoun.him}.` : ` ${by}.`)
    return (
      <Note tone="wait" className="st-notice">
        <span>
          {need.need ? (
            <>
              <b>
                Open a new {need.className} stream for {needWord(need.need)}.
              </b>{" "}
              {full}
              {askedBy}
            </>
          ) : (
            <>
              <b>Open a new {need.className} stream.</b>
              {full && ` ${full}`}
              {need.waiting > 0 && ` ${need.waiting} ${need.waiting === 1 ? "child waits" : "children wait"} for a seat.`}
              {askedBy}
            </>
          )}
        </span>
        <OpenStreamButton
          year={year}
          className={need.className}
          streams={classStreams}
          need={need.need ?? "Mixed"}
          label={`Open a new ${need.className} stream`}
          variant="go"
        />
      </Note>
    )
  }
  if (asked) {
    return (
      <Note className="st-notice">
        <span>
          <b>Request sent at {tanzaniaTime(asked.requestedAt)}.</b> The Admissions Manager has been asked to open a new {need.className} stream
          {need.need ? ` for ${needWord(need.need)}` : ""}. You’ll see it here when it’s open.
        </span>
      </Note>
    )
  }
  return (
    <Note tone="wait" className="st-notice">
      <span>
        <b>
          {need.className} has no seat left
          {need.need ? ` for ${needWord(need.need)}` : ""}.
        </b>{" "}
        {full && `${full} `}Only the Admissions Manager can open a new stream.
      </span>
      <RequestStreamButton
        // For a child with no Boy or girl answer in a class with Boys or
        // Girls streams, the request is the child's: the database checks a
        // class request for any child against every free seat.
        target={need.askFor ? { leadId: need.askFor } : { year, className: need.className, need: need.need }}
        className={need.className}
        need={need.need}
        variant={need.need ? "go" : "ghost"}
      />
    </Note>
  )
}

function ClassCard({
  className,
  year,
  entry,
  who,
  placed,
}: {
  className: LeadClass
  year: number
  entry: ClassStreams | undefined
  who: Who
  // The children placed in the class’s streams, for the Change sheet; null when they couldn’t be read, which hides the pencils.
  placed: PlacedChild[] | null
}) {
  const streams = (entry?.streams ?? []).toSorted((a, b) => a.position - b.position)
  const add = who.manages ? <OpenStreamButton year={year} className={className} streams={streams} label="Add a stream" /> : null
  if (streams.length === 0) {
    return (
      <Card className="st-class">
        <header className="st-class-head">
          <div>
            <h2 className="kit-card-title">{className}</h2>
            <p className="kit-card-cap">Seats not set · no limit</p>
          </div>
          {add}
        </header>
        <p className="st-text st-empty">Any child can take a seat in {className}: it has no streams, so nothing is ever blocked here.</p>
      </Card>
    )
  }
  const held = streams.reduce((sum, s) => sum + s.placed, 0)
  const seats = streams.reduce((sum, s) => sum + s.seats, 0)
  return (
    <Card className="st-class">
      <header className="st-class-head">
        <div>
          <h2 className="kit-card-title">{className}</h2>
          <p className="kit-card-cap st-num">
            {held} of {seats} seats taken · {streams.length} {streams.length === 1 ? "stream" : "streams"}
          </p>
        </div>
        {add}
      </header>
      <ol className="st-streams" aria-label={`${className} streams`}>
        {streams.map((stream, i) => {
          const free = Math.max(0, stream.seats - stream.placed)
          const full = stream.seats === 0 || free === 0
          return (
            <li key={stream.id} data-full={full || undefined}>
              <span className="st-pos">{i + 1}</span>
              <span className="st-stream">
                <b>
                  {stream.label ? `${className} ${stream.label}` : className}
                </b>
                <TakesTag takes={stream.takes} />
                {mixLine(stream) && <span className="st-mix st-num">{mixLine(stream)}</span>}
              </span>
              <span className="st-meter" aria-hidden>
                <i
                  style={{
                    width: `${stream.seats ? Math.round((stream.placed / stream.seats) * 100) : 100}%`,
                  }}
                />
              </span>
              <span className="st-count st-num">
                {stream.seats === 0 ? <Tag tone="wait">Type the places</Tag> : free === 0 ? <Tag tone="bad">Full</Tag> : `${free} free`}
                <small>
                  {stream.placed} of {stream.seats}
                </small>
              </span>
              {who.manages && placed !== null && (
                <ChangeStreamButton
                  year={year}
                  className={className}
                  stream={stream}
                  streams={streams}
                  placed={placed}
                  waiting={entry?.waiting ?? []}
                />
              )}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

function WaitingCard({ classes, who }: { classes: ClassStreams[]; who: Who }) {
  const waiting = classes
    .toSorted((a, b) => LEAD_CLASSES.indexOf(a.className) - LEAD_CLASSES.indexOf(b.className))
    .flatMap((each) => each.waiting.toSorted((a, b) => a.rank - b.rank).map((child) => ({ ...child, className: each.className })))
  if (waiting.length === 0) return null
  return (
    <Card
      title="Waiting for a stream"
      caption="They hold a Seat priority but no stream has a free seat that takes them. They take the first seat that frees, in this order."
    >
      <ol className="st-list">
        {waiting.map((child, i) => (
          <li key={child.leadId}>
            <span className="st-no">{i + 1}.</span>
            <span className="st-who">
              <Link href={`/staff/applicants/${child.leadId}`} className="st-name">
                {child.studentName}
              </Link>
              <span className="st-cap">
                {child.className} · {child.priority} since {formatDate(child.reachedOn)}
              </span>
            </span>
            {who.mayDecline && (
              <Link
                href={declineHref(child.leadId, SEAT_RELEASE_REASON)}
                aria-label={`Decline ${child.studentName}: ${SEAT_RELEASE_REASON}`}
                className="st-decline"
              >
                Decline: {SEAT_RELEASE_REASON}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}

export function StreamsView({
  data,
  previous,
  who,
  tabs,
  placed = null,
}: {
  data: YearStreams
  previous: YearStreams | null
  who: Who
  tabs: ReactNode
  // Every child placed in a stream of the year, read only for staff who manage streams; null hides the pencils.
  placed?: PlacedChild[] | null
}) {
  const year = data.year
  const byClass = new Map(data.classes.map((each) => [each.className, each]))
  const needs = seatNeeds(data.classes, data.requests)
  const plan = previous ? bringUpPlan(previous.classes, data.classes) : []
  const zero = data.classes.flatMap((c) => c.streams).filter((s) => s.seats === 0).length
  const streamCount = data.classes.reduce((n, c) => n + c.streams.length, 0)
  const fresh = plan.length > 0
  return (
    <>
      <PageHeader
        title="Seats"
        subtitle={
          fresh
            ? "A new year starts with no streams. The Manager brings last year’s streams up one class and types the places for new students."
            : "Streams and their seats for the Enrollment year. Each child takes a seat in the first stream of their class, in order, that has a free seat and takes them. Seats are the places for new students, not the stream’s size."
        }
      />
      <div className="st-stack">
        {tabs}
        <div className="st-bar">
          <p className="st-text">
            Year <b>{year}</b>
            {!fresh && " · Day or boarding no longer splits seats; it only sets the fee."}
          </p>
          {who.manages && fresh && <BringUpButton year={year} rows={plan} />}
        </div>

        {fresh &&
          (who.manages ? (
            <Note>
              <b>
                {plan.length} {plan.length === 1 ? "stream" : "streams"} from {year - 1} can come up.
              </b>
            </Note>
          ) : (
            <Note>
              {year} has {streamCount === 1 ? "one stream" : `${streamCount} streams`} so far. Only the Admissions Manager can bring up last year’s streams.
            </Note>
          ))}
        {who.manages && zero > 0 && (
          <Note tone="wait">
            <b>
              {zero} {zero === 1 ? "stream has" : "streams have"} 0 seats.
            </b>{" "}
            Children can’t take a seat in them until you type the places. Use the pencil on each.
          </Note>
        )}

        {needs.map((need) => (
          <NeedNotice
            key={`${need.className}-${need.need ?? "any"}`}
            need={need}
            year={year}
            classStreams={byClass.get(need.className)?.streams ?? []}
            who={who}
          />
        ))}

        <WaitingCard classes={data.classes} who={who} />

        <div className="st-grid">
          {LEAD_CLASSES.map((className) => (
            <ClassCard
              key={className}
              className={className}
              year={year}
              entry={byClass.get(className)}
              who={who}
              placed={placed === null ? null : placed.filter((child) => child.className === className)}
            />
          ))}
        </div>
      </div>
    </>
  )
}
