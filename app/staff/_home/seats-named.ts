import type { ClassStreamFigures } from "@/lib/services/dashboard"
import type { FullClass } from "@/lib/services/home-activity"
import { LEAD_CLASSES } from "@/lib/services/leads"
import { streamName, type YearStreams } from "@/lib/services/streams"

import { afterQueue, seatNeeds } from "../seats/stream-rules"
import { seatsTabOf, type SeatsTab } from "./charts"

// Home's seats in streams (#449, prototype v42), from the same reads and the
// same notices as the Seats screen and Reports, so they never disagree.

const sum = <T>(items: readonly T[], value: (item: T) => number) => items.reduce((total, item) => total + value(item), 0)

/**
 * One capsule per class with streams, adding its streams up: the children
 * placed in them who paid in full, and those who paid part (a Deposit or a
 * First instalment). A class reads Full only when none of its streams has a
 * free seat, so FORM 1 still shows seats while its Girls stream has some.
 */
export function namedSeatsTab(classes: readonly ClassStreamFigures[]): SeatsTab | null {
  return seatsTabOf(
    classes
      .filter((entry) => entry.streams.length > 0)
      .toSorted((a, b) => LEAD_CLASSES.indexOf(a.className) - LEAD_CLASSES.indexOf(b.className))
      .map(({ className, streams }) => {
        const free = sum(streams, (stream) => stream.free)
        return {
          className,
          seats: sum(streams, (stream) => stream.seats),
          paid: sum(streams, (stream) => stream.full),
          partial: sum(streams, (stream) => stream.firstInstalment + stream.deposit),
          free,
          full: free === 0,
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
