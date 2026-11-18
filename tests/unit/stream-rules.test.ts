import { describe, expect, test } from "vitest"

import { afterQueue, bringUpPlan, clashingStream, labelAt, nextLabel, placeholderSeats, seatNeeds, tanzaniaTime } from "@/app/staff/seats/stream-rules"
import type { LeadClass } from "@/lib/services/leads"
import type { ClassStreams, Stream, StreamRequest, StreamTakes, WaitingChild } from "@/lib/services/streams"

// The Seats screen's suggestions and notices (#449, v42). The database
// decides; these must agree with it on what they suggest.

let ids = 0
function stream(label: string, takes: StreamTakes, seats = 10, placed = 0, extra: Partial<Stream> = {}): Stream {
  ids += 1
  return {
    id: `s${ids}`,
    label,
    takes,
    seats,
    position: ids,
    placed,
    broughtUpFrom: null,
    ...extra,
  }
}

function cls(className: LeadClass, streams: Stream[], free: Partial<Pick<ClassStreams, "freeForBoy" | "freeForGirl" | "freeForAny">> = {}): ClassStreams {
  return {
    className,
    streams,
    freeForBoy: true,
    freeForGirl: true,
    freeForAny: true,
    waiting: [],
    ...free,
  }
}

function request(className: LeadClass, need: "Boys" | "Girls" | null, at: string, resolvedAt: string | null = null): StreamRequest {
  return {
    id: `r-${at}`,
    className,
    need,
    leadId: null,
    studentName: null,
    requestedByName: "Asha",
    requestedByRole: "Admissions Staff",
    requestedAt: at,
    resolvedAt,
    resolvedByStreamId: null,
  }
}

function child(leadId: string, gender: WaitingChild["gender"], rank = 1): WaitingChild {
  return {
    leadId,
    admissionNumber: leadId,
    studentName: leadId,
    gender,
    priority: "Deposit",
    reachedOn: "2027-01-10",
    rank,
  }
}

describe("labels", () => {
  test("run A to Z, then AA, AB … AZ, BA", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(labelAt)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"])
  })

  test("Boys and Girls may share a letter; Mixed shares with neither", () => {
    const form1 = [stream("A", "Girls"), stream("B", "Boys")]
    expect(nextLabel(form1, "Boys")).toBe("A")
    expect(nextLabel(form1, "Girls")).toBe("B")
    expect(nextLabel(form1, "Mixed")).toBe("C")
    expect(nextLabel([stream("A", "Mixed")], "Boys")).toBe("B")
  })

  test("a clash ignores case and spaces", () => {
    const form1 = [stream("Ruby", "Boys")]
    expect(clashingStream(form1, " ruby ", "Boys")?.label).toBe("Ruby")
    expect(clashingStream(form1, "ruby", "Girls")).toBeNull()
  })
})

describe("placeholderSeats", () => {
  test("takes the latest stream with places, and none when every stream has 0", () => {
    expect(placeholderSeats([stream("A", "Mixed", 30), stream("B", "Mixed", 25), stream("C", "Mixed", 0)])).toBe(25)
    expect(placeholderSeats([stream("A", "Mixed", 0)])).toBeNull()
    expect(placeholderSeats([])).toBeNull()
  })
})

describe("seatNeeds", () => {
  test("a Mixed-only class that is full gives one notice for any child", () => {
    const std6 = cls("STD 6", [stream("A", "Mixed", 30, 30), stream("B", "Mixed", 25, 25)], { freeForAny: false, freeForBoy: false, freeForGirl: false })
    const needs = seatNeeds([std6], [])
    expect(needs).toHaveLength(1)
    expect(needs[0]).toMatchObject({ className: "STD 6", need: null })
    expect(needs[0].fullStream?.label).toBe("B")
  })

  test("a split class gives a notice only for the need it takes and has no seat for", () => {
    const form1 = cls("FORM 1", [stream("A", "Girls", 20, 5), stream("B", "Boys", 20, 20)], { freeForBoy: false, freeForAny: false })
    const needs = seatNeeds([form1], [])
    expect(needs.map((n) => n.need)).toEqual(["Boys"])
    expect(needs[0].fullStream?.label).toBe("B")
  })

  test("no notice for a need no stream takes, nor for a class without streams", () => {
    const girlsOnly = cls("FORM 2", [stream("A", "Girls", 20, 20)], {
      freeForBoy: false,
      freeForGirl: false,
      freeForAny: false,
    })
    expect(seatNeeds([girlsOnly, cls("DAY CARE", [])], []).map((n) => n.need)).toEqual(["Girls"])
  })

  test("carries the newest open request for the same class and need", () => {
    const form1 = cls("FORM 1", [stream("B", "Boys", 20, 20)], {
      freeForBoy: false,
      freeForAny: false,
    })
    const requests = [
      request("FORM 1", "Boys", "2027-01-10T06:00:00Z"),
      request("FORM 1", "Boys", "2027-01-11T06:40:00Z"),
      request("FORM 1", "Boys", "2027-01-12T06:00:00Z", "2027-01-12T07:00:00Z"),
      request("FORM 1", "Girls", "2027-01-13T06:00:00Z"),
    ]
    expect(seatNeeds([form1], requests)[0].request?.requestedAt).toBe("2027-01-11T06:40:00Z")
  })

  test("children with no Boy or girl answer get a notice for any child when no Mixed stream is there, though Boys and Girls seats are free", () => {
    // As the database reports it: seats free for boys, for girls and so for "any" child.
    const split = { ...cls("FORM 1", [stream("A", "Girls", 20, 5), stream("B", "Boys", 20, 5)]), waiting: [child("y", null, 2), child("x", null, 1)] }
    const needs = seatNeeds([split], [])
    expect(needs).toHaveLength(1)
    // Other staff ask for the first of them by rank, not for the class.
    expect(needs[0]).toMatchObject({ className: "FORM 1", need: null, waiting: 2, fullStream: null, askFor: "x" })

    const withMixed = { ...cls("FORM 2", [stream("A", "Mixed", 20, 20), stream("B", "Boys", 20, 5)], { freeForGirl: false }), waiting: [child("z", null)] }
    expect(seatNeeds([withMixed], []).find((n) => n.need === null)).toMatchObject({ askFor: "z", fullStream: { label: "A" } })

    // None without an answer waits and no request is open: no notice.
    expect(seatNeeds([{ ...split, waiting: [child("b", "Boy")] }], [])).toEqual([])
    expect(seatNeeds([{ ...split, waiting: [] }], [request("FORM 1", null, "2027-01-10T06:00:00Z", "2027-01-10T07:00:00Z")])).toEqual([])
    // A request sent from such a child's page is enough, and needs no child to ask for.
    expect(seatNeeds([{ ...split, waiting: [] }], [request("FORM 1", null, "2027-01-11T06:40:00Z")])[0]).toMatchObject({ need: null, askFor: null })
  })

  test("no notice for any child while a Mixed seat is left after the queue, though one waits and a request is open", () => {
    // Two Mixed seats free: the child waiting (a busy row, so a retry is pending) takes one, and one is left.
    const form1 = { ...cls("FORM 1", [stream("A", "Mixed", 20, 18), stream("B", "Boys", 20, 20)]), waiting: [child("x", null)] }
    expect(seatNeeds([form1], [request("FORM 1", null, "2027-01-11T06:40:00Z")])).toEqual([])
  })

  test("a Mixed stream with one free seat and two children with no Boy or girl answer waiting gives the notice, asking for the one left out", () => {
    const streams = [stream("A", "Mixed", 20, 19), stream("B", "Girls", 20, 5), stream("C", "Boys", 20, 5)]
    const form1 = { ...cls("FORM 1", streams), waiting: [child("x", null, 1), child("y", null, 2)] }
    const needs = seatNeeds([form1], [])
    expect(needs).toHaveLength(1)
    // The first takes the Mixed seat on their retry; only the second still needs a stream.
    expect(needs[0]).toMatchObject({ need: null, waiting: 1, fullStream: { label: "A" }, request: null, askFor: "y" })
  })

  test("a child the last Mixed seat is for gets no notice, nor does their own open request; another child's request does", () => {
    const streams = [stream("A", "Mixed", 20, 19), stream("B", "Girls", 20, 5), stream("C", "Boys", 20, 5)]
    const form1 = { ...cls("FORM 1", streams), waiting: [child("x", null)] }
    const own = { ...request("FORM 1", null, "2027-01-11T06:40:00Z"), leadId: "x" }
    expect(seatNeeds([form1], [])).toEqual([])
    expect(seatNeeds([form1], [own])).toEqual([])
    // A child who can't pay yet holds no Seat priority, so they aren't in the queue: the seat is not theirs.
    const needs = seatNeeds([form1], [own, { ...request("FORM 1", null, "2027-01-11T06:00:00Z"), leadId: "other" }])
    expect(needs).toHaveLength(1)
    expect(needs[0]).toMatchObject({ need: null, waiting: 0, askFor: null, request: { leadId: "other" } })
  })
})

describe("afterQueue", () => {
  test("seats each child waiting in rank order, in the first stream by position that takes them", () => {
    const mixed = stream("A", "Mixed", 10, 8)
    const boys = stream("B", "Boys", 10, 9)
    const girls = stream("C", "Girls", 10, 10)
    // Out of order on purpose, streams and children both.
    const waiting = [child("no-answer", null, 4), child("boy-2", "Boy", 2), child("girl", "Girl", 3), child("boy-1", "Boy", 1), child("boy-3", "Boy", 5)]
    const after = afterQueue([girls, boys, mixed], waiting)
    // The first two boys take the Mixed seats, which come first; the girl finds Mixed and Girls full; the third boy takes the Boys seat.
    expect(after.unseated.map((w) => w.leadId)).toEqual(["girl", "no-answer"])
    expect(after.mixedSeatLeft).toBe(false)
  })

  test("a child with no Boy or girl answer takes a Mixed seat only", () => {
    const streams = [stream("A", "Boys", 10, 0), stream("B", "Girls", 10, 0), stream("C", "Mixed", 10, 9)]
    expect(afterQueue(streams, [child("x", null, 1), child("y", null, 2)])).toMatchObject({ unseated: [{ leadId: "y" }], mixedSeatLeft: false })
    expect(afterQueue(streams, [])).toEqual({ unseated: [], mixedSeatLeft: true })
    expect(afterQueue(streams.slice(0, 2), [])).toEqual({ unseated: [], mixedSeatLeft: false })
  })

  test("a stream with 0 seats takes no one", () => {
    expect(afterQueue([stream("A", "Mixed", 0, 0)], [child("x", "Girl")])).toMatchObject({ unseated: [{ leadId: "x" }], mixedSeatLeft: false })
  })
})

describe("bringUpPlan", () => {
  test("moves each stream up one class, renames a clash, skips FORM 4 and streams already brought up", () => {
    const std7a = stream("A", "Mixed", 30)
    const std7b = stream("B", "Mixed", 30)
    const form4 = stream("A", "Mixed", 30)
    const form2 = stream("A", "Boys", 30)
    const previous = [cls("STD 7", [std7a, std7b]), cls("FORM 4", [form4]), cls("FORM 2", [form2])]
    const current = [cls("FORM 1", [stream("A", "Mixed", 40)]), cls("FORM 3", [stream("A", "Boys", 0, 0, { broughtUpFrom: form2.id })])]
    const rows = bringUpPlan(previous, current)
    expect(rows.map((r) => [r.source.id, r.toClass, r.label, r.renamed])).toEqual([
      [std7a.id, "FORM 1", "B", true],
      [std7b.id, "FORM 1", "C", true],
    ])
  })
})

describe("tanzaniaTime", () => {
  test("shows Tanzania's clock, three hours ahead of UTC", () => {
    expect(tanzaniaTime("2027-01-11T06:40:00Z")).toBe("09:40")
    expect(tanzaniaTime("2027-01-11T21:05:00Z")).toBe("00:05")
  })
})

describe("seatNeeds and requests from a child's page", () => {
  test("a full Mixed-only class shows a request sent for a child, whatever their need", () => {
    const std6 = cls("STD 6", [stream("A", "Mixed", 1, 1)], { freeForAny: false, freeForBoy: false, freeForGirl: false })
    const fromChild = { ...request("STD 6", "Girls", "2027-01-11T06:40:00Z"), studentName: "Rehema Saidi Bakari" }
    expect(seatNeeds([std6], [fromChild])[0].request?.studentName).toBe("Rehema Saidi Bakari")
  })
})
