import { describe, expect, it } from "vitest"

import { activityView } from "@/app/staff/_home/activity"
import { namedFullClasses, namedSeatsTab, needCaption } from "@/app/staff/_home/seats-named"
import type { Permission } from "@/lib/permissions"
import type { ClassStreamFigures, StreamSeatFigures } from "@/lib/services/dashboard"
import type { ClassStreams, Stream, StreamRequest, StreamTakes, YearStreams } from "@/lib/services/streams"

// Home once streams are on (#449, prototype v42): the Seats capsules, from
// Reports' counts by stream, and the Seats shortcut's caption and the "Class
// is full" rows, from the Seats screen's read.

let ids = 0
const stream = (label: string, takes: StreamTakes, seats: number, placed: number): Stream => {
  ids += 1
  return { id: `s${ids}`, label, takes, seats, position: ids, placed, boys: 0, girls: 0, broughtUpFrom: null }
}
const cls = (className: ClassStreams["className"], streams: Stream[], free: Partial<ClassStreams> = {}): ClassStreams => ({
  className,
  streams,
  freeForBoy: true,
  freeForGirl: true,
  freeForAny: true,
  waiting: [],
  ...free,
})
const year = (classes: ClassStreams[], requests: StreamRequest[] = []): YearStreams => ({ year: 2027, classes, requests })

// v42's year: STD 6 has one full Mixed stream; FORM 1 has Girls with room and Boys full.
const STD6 = cls("STD 6", [stream("A", "Mixed", 30, 30)], { freeForBoy: false, freeForGirl: false, freeForAny: false })
const FORM1 = cls("FORM 1", [stream("A", "Girls", 20, 12), stream("B", "Boys", 20, 20)], { freeForBoy: false })
const KG2 = cls("KG 2", [stream("A", "Mixed", 25, 10)])

// The same year as Reports counts it: each stream's placed children by Seat priority.
const figure = (seats: number, full: number, firstInstalment: number, deposit: number): StreamSeatFigures => {
  ids += 1
  return { id: `f${ids}`, label: "A", takes: "Mixed", seats, full, firstInstalment, deposit, free: Math.max(0, seats - full - firstInstalment - deposit) }
}
const figures = (className: ClassStreamFigures["className"], streams: StreamSeatFigures[]): ClassStreamFigures => ({
  className,
  streams,
  full: 0,
  firstInstalment: 0,
  deposit: 0,
  waiting: 0,
})

describe("the Seats capsules", () => {
  it("add up each class's streams, in class order, paid in full apart from a Deposit or First instalment, Full only when no stream has a free seat", () => {
    const tab = namedSeatsTab([
      figures("FORM 1", [figure(20, 8, 2, 2), figure(20, 15, 5, 0)]),
      figures("STD 6", [figure(30, 20, 6, 4)]),
      figures("KG 2", [figure(25, 6, 0, 4)]),
    ])
    expect(tab?.points.map((p) => [p.label, p.value, p.paid, p.partial, p.seats, p.free, p.full])).toEqual([
      ["KG 2", 10, 6, 4, 25, 15, false],
      ["STD 6", 30, 20, 10, 30, 0, true],
      ["FORM 1", 32, 23, 9, 40, 8, false],
    ])
  })

  it("leave out a class with seat holders but no streams, and show nothing for a year with no streams", () => {
    expect(namedSeatsTab([figures("STD 1", [])])).toBeNull()
    expect(namedSeatsTab([])).toBeNull()
  })
})

describe("the Seats shortcut's caption", () => {
  it("names the one class that needs a new stream, with its need, or counts the classes", () => {
    expect(needCaption(year([FORM1, KG2]))).toBe("FORM 1 needs a new stream for boys")
    expect(needCaption(year([STD6, KG2]))).toBe("STD 6 needs a new stream")
    expect(needCaption(year([FORM1, STD6]))).toBe("2 classes need a new stream")
    expect(needCaption(year([KG2]))).toBeNull()
  })
})

describe("the Class is full rows", () => {
  const MANAGER: Permission[] = ["academic_years.manage", "payments.view"]
  const context = { today: "2027-01-12", permissions: MANAGER }

  it("say who the class has no seat for, and which stream still has seats for the others", () => {
    const rows = namedFullClasses(year([FORM1, STD6]))
    expect(rows.map(({ need, elsewhere }) => ({ need, elsewhere }))).toEqual([
      { need: "Boys", elsewhere: "FORM 1 A (Girls)" },
      { need: null, elsewhere: null },
    ])
    const [boys, any] = rows.map((row) => activityView({ kind: "class_full", id: `${row.className} ${row.need ?? "any"}`, ...row }, context))
    expect(boys).toMatchObject({
      task: "Class is full",
      who: "FORM 1",
      about: "no free seat for boys",
      details: "FORM 1 A (Girls) still has seats for girls.",
      action: { label: "Open Seats", href: "/staff/seats" },
    })
    expect(any).toMatchObject({ who: "STD 6", about: "no free seat for any child", details: "Open Seats to see who waits." })
  })

  it("names no stream for the others when the children already waiting take its last seats", () => {
    const girl = { leadId: "g", admissionNumber: "ADMSN-1", studentName: "Girl", gender: "Girl" as const, priority: "Deposit" as const, reachedOn: "2027-01-10", rank: 1 }
    // FORM 1 A (Girls) shows one seat, but a girl waits for it (her row was busy).
    const busy = cls("FORM 1", [stream("A", "Girls", 20, 19), stream("B", "Boys", 20, 20)], { freeForBoy: false, freeForGirl: false, waiting: [girl] })
    expect(namedFullClasses(year([busy])).find((row) => row.need === "Boys")).toEqual({ className: "FORM 1", need: "Boys", elsewhere: null })
  })
})
