import type { FullClass } from "@/lib/services/home-activity"
import { LEAD_CLASSES } from "@/lib/services/leads"
import { streamName, type YearStreams } from "@/lib/services/streams"

import { afterQueue, seatNeeds } from "../seats/stream-rules"
import { seatsTabOf, type SeatsTab } from "./charts"

// Home's seats in streams (#449, prototype v42), from the same read and the
// same notices as the Seats screen, so the two never disagree.

const free = (stream: { seats: number; placed: number }) => Math.max(0, stream.seats - stream.placed)

/**
 * One bar per class with streams, adding its streams up. A class reads Full
 * only when none of its streams has a free seat, so FORM 1 still shows seats
 * while its Girls stream has some.
 */
export function namedSeatsTab(data: YearStreams): SeatsTab | null {
  const classes = data.classes
    .filter((entry) => entry.streams.length > 0)
    .toSorted((a, b) => LEAD_CLASSES.indexOf(a.className) - LEAD_CLASSES.indexOf(b.className))
  return seatsTabOf(
    classes.map(({ className, streams }) => {
      const left = streams.reduce((sum, stream) => sum + free(stream), 0)
      return {
        className,
        seats: streams.reduce((sum, stream) => sum + stream.seats, 0),
        held: streams.reduce((sum, stream) => sum + stream.placed, 0),
        full: left === 0,
        free: left,
      }
    }),
  )
}

/**
 * The Seats shortcut's caption: the class that needs a new stream when
 * exactly one does, for boys or girls when that is its one need, or how many
 * classes do. Null when none does.
 */
export function needCaption(data: YearStreams): string | null {
  const needs = seatNeeds(data.classes, data.requests)
  const classes = [...new Set(needs.map((need) => need.className))]
  if (classes.length === 0) return null
  if (classes.length > 1) return `${classes.length} classes need a new stream`
  const only = needs.length === 1 ? needs[0].need : null
  return `${classes[0]} needs a new stream${only ? ` for ${only.toLowerCase()}` : ""}`
}

/**
 * The "Class is full" rows: one per class and need with no free seat, with a
 * stream of the class that still has seats for the others, when there is one
 * once the children already waiting take theirs.
 */
export function namedFullClasses(data: YearStreams): FullClass[] {
  return seatNeeds(data.classes, data.requests).map((need) => {
    const entry = data.classes.find((each) => each.className === need.className)
    const streams = entry?.streams ?? []
    const other = need.need === "Boys" ? "Girls" : need.need === "Girls" ? "Boys" : null
    const queue = afterQueue(streams, entry?.waiting ?? [])
    const elsewhere = other ? streams.toSorted((a, b) => a.position - b.position).find((s) => s.takes === other && queue.freeAfter(s) > 0) : undefined
    return {
      className: need.className,
      need: need.need,
      elsewhere: elsewhere ? streamName(need.className, elsewhere.label, elsewhere.takes) : null,
    }
  })
}
