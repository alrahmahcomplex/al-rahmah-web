import { describe, expect, test } from "vitest"

import { bringUpPlan, clashingStream, labelAt, nextLabel, placeholderSeats, seatNeeds, tanzaniaTime } from "@/app/staff/seats/stream-rules"
import type { LeadClass } from "@/lib/services/leads"
import type { ClassStreams, Stream, StreamRequest, StreamTakes } from "@/lib/services/streams"

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
    expect(needs[0].fullStream.label).toBe("B")
  })

  test("a split class gives a notice only for the need it takes and has no seat for", () => {
    const form1 = cls("FORM 1", [stream("A", "Girls", 20, 5), stream("B", "Boys", 20, 20)], { freeForBoy: false, freeForAny: false })
    const needs = seatNeeds([form1], [])
    expect(needs.map((n) => n.need)).toEqual(["Boys"])
    expect(needs[0].fullStream.label).toBe("B")
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
