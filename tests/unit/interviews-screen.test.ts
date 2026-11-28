import { describe, expect, it } from "vitest"

import {
  admissionMarks,
  boardQuery,
  defaultInterviewYear,
  EMPTY_BOARD,
  interviewsHref,
  matchesSearch,
  nameMarks,
  narrowed,
  nextSort,
  pageCount,
  pageOf,
  parseBoard,
  parseYear,
  passes,
  searchTerms,
  sortRows,
  type BoardRow,
  type BoardState,
} from "@/app/staff/interviews/board"
import { interviewsBackHref, recordFromInterviews } from "@/app/staff/interviews/record-link"
import { navFor, STAFF_NAV } from "@/app/staff/navigation"

// The Interviews list's rules (prototype 1MpUKuX27V6pc1CS1z1URz v5): the
// search, the filters, the sort, the pages and the address.

let next = 0
function row(overrides: Partial<BoardRow>): BoardRow {
  next += 1
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    leadId: `00000000-0000-4000-9000-${String(next).padStart(12, "0")}`,
    serialNumber: next,
    admissionNumber: `ADMSN-${String(100 + next).padStart(5, "0")}`,
    studentName: "Sample Pupil",
    className: "STD 1",
    dayOrBoarding: "Day",
    registeredOn: "2026-11-01",
    result: null,
    score: null,
    feeStatus: "Paid",
    sentOn: null,
    closed: null,
    ...overrides,
  }
}

const state = (changes: Partial<BoardState>): BoardState => ({ ...EMPTY_BOARD, ...changes })

describe("the search", () => {
  const amina = row({ studentName: "Amina Juma Mrisho", admissionNumber: "ADMSN-00142", serialNumber: 7 })

  it("matches the start of any part of the name, in any order and any case", () => {
    expect(matchesSearch(amina, searchTerms("ami"))).toBe(true)
    expect(matchesSearch(amina, searchTerms("JUMA"))).toBe(true)
    expect(matchesSearch(amina, searchTerms("mri amina"))).toBe(true)
    expect(matchesSearch(amina, searchTerms("  "))).toBe(true)
  })

  it("needs every word typed, and only at the start of a part", () => {
    expect(matchesSearch(amina, searchTerms("amina zawadi"))).toBe(false)
    expect(matchesSearch(row({ studentName: "Khalid Ally" }), searchTerms("ali"))).toBe(false)
    expect(matchesSearch(row({ studentName: "Ally Hemedi" }), searchTerms("ali"))).toBe(false)
    expect(matchesSearch(row({ studentName: "Ally Hemedi" }), searchTerms("all"))).toBe(true)
  })

  it("ignores accents", () => {
    expect(matchesSearch(row({ studentName: "Amína Salim" }), searchTerms("amina"))).toBe(true)
  })

  it("finds the Admission Number by its digits, with or without the leading zeros, and the S/N", () => {
    expect(matchesSearch(amina, searchTerms("142"))).toBe(true)
    expect(matchesSearch(amina, searchTerms("00142"))).toBe(true)
    expect(matchesSearch(amina, searchTerms("admsn-00142"))).toBe(true)
    expect(matchesSearch(amina, searchTerms("7"))).toBe(true)
    expect(matchesSearch(amina, searchTerms("42"))).toBe(false)
  })

  it("marks the matched start of each name part and of the Admission Number's digits", () => {
    expect(nameMarks("Amina Juma Mrisho", searchTerms("am ju"))).toEqual([
      [0, 2],
      [6, 8],
    ])
    expect(nameMarks("Amina Amani", searchTerms("a ami"))).toEqual([
      [0, 3],
      [6, 7],
    ])
    expect(nameMarks("Amina", [])).toEqual([])
    expect(admissionMarks("ADMSN-00142", searchTerms("14"))).toEqual([[8, 10]])
    expect(admissionMarks("ADMSN-00142", searchTerms("amina"))).toEqual([])
  })
})

describe("the filters", () => {
  const rows = [
    row({ className: "KG 1", registeredOn: "2026-11-10", result: "Passed", score: 80, feeStatus: "Paid", sentOn: "2026-11-12" }),
    row({ className: "KG 2", registeredOn: "2026-11-10", result: null, feeStatus: "Not Paid" }),
    row({ className: "STD 3", registeredOn: "2026-11-11", result: "Failed", score: 30, feeStatus: "Paid" }),
  ]
  const kept = (s: BoardState) => rows.filter((r) => passes(r, s, searchTerms(s.q))).map((r) => r.className)

  it("keeps the rows of any of the classes picked", () => {
    expect(kept(state({ classes: ["KG 1", "KG 2"] }))).toEqual(["KG 1", "KG 2"])
    expect(kept(state({ classes: [] }))).toEqual(["KG 1", "KG 2", "STD 3"])
  })

  it("keeps the day registered, the result, the fee and whether the result was sent", () => {
    expect(kept(state({ date: "2026-11-10" }))).toEqual(["KG 1", "KG 2"])
    expect(kept(state({ result: "none" }))).toEqual(["KG 2"])
    expect(kept(state({ result: "Failed" }))).toEqual(["STD 3"])
    expect(kept(state({ fee: "Not Paid" }))).toEqual(["KG 2"])
    expect(kept(state({ sent: "sent" }))).toEqual(["KG 1"])
    expect(kept(state({ sent: "not-sent" }))).toEqual(["KG 2", "STD 3"])
  })

  it("applies the filters together, and leaves one out for that filter's own counts", () => {
    const both = state({ date: "2026-11-10", fee: "Paid" })
    expect(kept(both)).toEqual(["KG 1"])
    expect(rows.filter((r) => passes(r, both, [], "fee")).map((r) => r.className)).toEqual(["KG 1", "KG 2"])
  })

  it("says whether anything narrows the list", () => {
    expect(narrowed(EMPTY_BOARD)).toBe(false)
    expect(narrowed(state({ q: "  " }))).toBe(false)
    expect(narrowed(state({ q: "ami" }))).toBe(true)
    expect(narrowed(state({ classes: ["KG 1"] }))).toBe(true)
  })
})

describe("the order", () => {
  const a = row({ serialNumber: 1, className: "STD 3", score: 50, registeredOn: "2026-11-01" })
  const b = row({ serialNumber: 2, className: "KG 1", score: null, registeredOn: "2026-11-02" })
  const c = row({ serialNumber: 3, className: "KG 1", score: 90, registeredOn: "2026-11-03" })
  const sns = (rows: BoardRow[]) => rows.map((r) => r.serialNumber)

  it("opens with the newest registration first", () => {
    expect(sns(sortRows([a, b, c], null))).toEqual([3, 2, 1])
  })

  it("sorts a column lowest or highest first, empty values last, ties newest first", () => {
    expect(sns(sortRows([a, b, c], { key: "score", dir: "asc" }))).toEqual([1, 3, 2])
    expect(sns(sortRows([a, b, c], { key: "score", dir: "desc" }))).toEqual([3, 1, 2])
    expect(sns(sortRows([a, b, c], { key: "class", dir: "asc" }))).toEqual([3, 2, 1])
    expect(sns(sortRows([a, b, c], { key: "sn", dir: "asc" }))).toEqual([1, 2, 3])
  })

  it("moves each column through lowest first, highest first and back to the page's own order", () => {
    expect(nextSort(null, "sn")).toEqual({ key: "sn", dir: "asc" })
    expect(nextSort({ key: "sn", dir: "asc" }, "sn")).toEqual({ key: "sn", dir: "desc" })
    expect(nextSort({ key: "sn", dir: "desc" }, "sn")).toBeNull()
    expect(nextSort({ key: "score", dir: "desc" }, "class")).toEqual({ key: "class", dir: "asc" })
  })
})

describe("the pages", () => {
  it("shows fifty a page and keeps the page asked for within the list", () => {
    const rows = Array.from({ length: 142 }, (_, i) => i)
    expect(pageCount(142)).toBe(3)
    expect(pageCount(0)).toBe(1)
    expect(pageOf(rows, 3)).toMatchObject({ page: 3, from: 100 })
    expect(pageOf(rows, 3).rows).toHaveLength(42)
    expect(pageOf(rows, 9).page).toBe(3)
    expect(pageOf(rows, 0).page).toBe(1)
  })
})

describe("the address", () => {
  it("reads the search, filters, sort, page and open sheet", () => {
    const params = new URLSearchParams(
      "q=amina&date=2026-11-10&class=KG 2,KG 1,NURSERY&result=passed&fee=not-paid&sent=not-sent&sort=score&dir=desc&page=2&open=00000000-0000-4000-8000-000000000001",
    )
    expect(parseBoard(params)).toEqual({
      q: "amina",
      date: "2026-11-10",
      classes: ["KG 2", "KG 1"],
      result: "Passed",
      fee: "Not Paid",
      sent: "not-sent",
      sort: { key: "score", dir: "desc" },
      page: 2,
      open: "00000000-0000-4000-8000-000000000001",
    })
  })

  it("drops anything it can't read", () => {
    expect(parseBoard(new URLSearchParams("date=2026-13-40&result=x&fee=y&sent=z&sort=name&dir=asc&page=-3&open=not-an-id"))).toEqual(EMPTY_BOARD)
    expect(parseBoard(new URLSearchParams("sort=score"))).toEqual(EMPTY_BOARD)
  })

  it("writes back what it reads, leaving out the defaults, with the year first", () => {
    const s = state({ q: "ami", classes: ["KG 2", "KG 1"], sort: { key: "class", dir: "asc" }, page: 2 })
    expect(parseBoard(boardQuery(s))).toEqual({ ...s, classes: ["KG 1", "KG 2"] })
    expect(interviewsHref(2027)).toBe("/staff/interviews?year=2027")
    expect(interviewsHref(2027, state({ fee: "Paid" }))).toBe("/staff/interviews?year=2027&fee=paid")
  })

  it("reads the year, refusing anything else", () => {
    expect(parseYear("2027")).toBe(2027)
    expect(parseYear(["2026", "2027"])).toBe(2026)
    expect(parseYear("27")).toBeUndefined()
    expect(parseYear("1999")).toBeUndefined()
    expect(parseYear(undefined)).toBeUndefined()
  })
})

describe("View full record and back", () => {
  it("opens the record on its Interview tab, carrying the list", () => {
    expect(recordFromInterviews("lead-1", "/staff/interviews?year=2027&q=ami")).toBe("/staff/applicants/lead-1?tab=interview&from=year%3D2027%26q%3Dami")
  })

  it("leads back to the same list, without its open sheet, and nowhere else", () => {
    expect(interviewsBackHref("year=2027&q=ami&open=00000000-0000-4000-8000-000000000001")).toBe("/staff/interviews?year=2027&q=ami")
    expect(interviewsBackHref("interviews")).toBe("/staff/interviews")
    expect(interviewsBackHref("year=2027&next=https://example.com")).toBe("/staff/interviews?year=2027")
    expect(interviewsBackHref(undefined)).toBeNull()
  })
})

describe("defaultInterviewYear", () => {
  it("opens on the current year when it has registrations", () => {
    expect(defaultInterviewYear([2026, 2027], 2027)).toBe(2027)
  })

  it("otherwise opens on the next year that has registrations", () => {
    expect(defaultInterviewYear([2025, 2028, 2029], 2027)).toBe(2028)
  })

  it("otherwise opens on the latest year, and on the current year with none at all", () => {
    expect(defaultInterviewYear([2024, 2025], 2027)).toBe(2025)
    expect(defaultInterviewYear([], 2027)).toBe(2027)
  })
})

describe("the Interviews navigation entry", () => {
  it("shows Interviews to anyone who may view leads, and to no one else", () => {
    const interviews = STAFF_NAV.find((entry) => entry.label === "Interviews")
    expect(interviews).toMatchObject({ href: "/staff/interviews", label: "Interviews", group: "Admissions", permission: "leads.view" })
    expect(navFor(["leads.view"])).toContain(interviews)
    expect(navFor(["payments.view", "interview_payments.record"])).not.toContain(interviews)
  })
})
