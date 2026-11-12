import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  addDays,
  isIsoDate,
  isoOf,
  joinDateTime,
  localOf,
  mondayOf,
  parseDayFirst,
  parseTime,
  showDayFirst,
  splitDateTime,
  withinBounds,
} from "@/components/kit/dates"

// The kit's day-first dates and 24-hour times (#358). A date is submitted as
// "YYYY-MM-DD" and a date with a time as the datetime-local format, so no
// server action changes.

describe("parseDayFirst", () => {
  it("reads the day first and gives YYYY-MM-DD", () => {
    expect(parseDayFirst("25/09/2026")).toBe("2026-09-25")
    expect(parseDayFirst("03/04/2026")).toBe("2026-04-03")
  })

  it("reads a pasted year-first date too", () => {
    expect(parseDayFirst("2027-01-11")).toBe("2027-01-11")
    expect(parseDayFirst("2027-1-5")).toBe("2027-01-05")
    expect(showDayFirst(parseDayFirst("2027-01-11")!)).toBe("11/01/2027")
  })

  it("tidies a short day and month", () => {
    expect(parseDayFirst("5/9/2026")).toBe("2026-09-05")
    expect(showDayFirst(parseDayFirst("5/9/2026")!)).toBe("05/09/2026")
  })

  it("accepts dots, dashes and spaces between the parts", () => {
    expect(parseDayFirst("5.9.2026")).toBe("2026-09-05")
    expect(parseDayFirst("5-9-2026")).toBe("2026-09-05")
    expect(parseDayFirst(" 5 9 2026 ")).toBe("2026-09-05")
  })

  it("refuses impossible dates", () => {
    expect(parseDayFirst("31/02/2026")).toBeNull()
    expect(parseDayFirst("29/02/2026")).toBeNull()
    expect(parseDayFirst("31/04/2026")).toBeNull()
    expect(parseDayFirst("00/01/2026")).toBeNull()
    expect(parseDayFirst("12/13/2026")).toBeNull()
  })

  it("accepts 29 February in a leap year only", () => {
    expect(parseDayFirst("29/02/2028")).toBe("2028-02-29")
    expect(parseDayFirst("29/02/2100")).toBeNull()
    expect(parseDayFirst("29/02/2000")).toBe("2000-02-29")
  })

  it("refuses text that is not a day-first date", () => {
    for (const text of ["", "2026-13-01", "2026-02-30", "25/09/26", "25/09", "tomorrow", "25/09/2026x", "1/1/202"]) expect(parseDayFirst(text)).toBeNull()
  })
})

describe("showDayFirst", () => {
  it("shows YYYY-MM-DD as DD/MM/YYYY and nothing for a non-date", () => {
    expect(showDayFirst("2026-09-05")).toBe("05/09/2026")
    expect(showDayFirst("")).toBe("")
    expect(showDayFirst("2026-02-31")).toBe("")
    expect(isIsoDate("2026-02-28")).toBe(true)
    expect(isIsoDate("2026-2-28")).toBe(false)
  })
})

describe("parseTime", () => {
  it("tidies a typed time to HH:MM", () => {
    expect(parseTime("930")).toBe("09:30")
    expect(parseTime("9:30")).toBe("09:30")
    expect(parseTime("1430")).toBe("14:30")
    expect(parseTime("14.30")).toBe("14:30")
    expect(parseTime("0000")).toBe("00:00")
    expect(parseTime("23:59")).toBe("23:59")
  })

  it("refuses a time that is not on the 24-hour clock", () => {
    for (const text of ["25:00", "24:00", "12:60", "9", "12345", "ab:cd", "", "9:3"]) expect(parseTime(text)).toBeNull()
  })
})

describe("bounds", () => {
  it("compares YYYY-MM-DD days, with either bound optional", () => {
    expect(withinBounds("2026-11-12", "2026-11-01", "2026-11-30")).toBe(true)
    expect(withinBounds("2026-10-31", "2026-11-01", "2026-11-30")).toBe(false)
    expect(withinBounds("2026-12-01", "2026-11-01", "2026-11-30")).toBe(false)
    expect(withinBounds("2026-12-01", undefined, "2026-12-01")).toBe(true)
    expect(withinBounds("1999-01-01")).toBe(true)
  })
})

describe("datetime-local", () => {
  it("joins a date and a time, and splits them again", () => {
    expect(joinDateTime("2026-11-12", "09:30")).toBe("2026-11-12T09:30")
    expect(joinDateTime("2026-11-12", "")).toBe("")
    expect(joinDateTime("", "09:30")).toBe("")
    expect(splitDateTime("2026-11-12T09:30")).toEqual({ date: "2026-11-12", time: "09:30" })
    expect(splitDateTime("2026-11-12T09:30:15")).toEqual({ date: "2026-11-12", time: "09:30" })
    expect(splitDateTime("")).toEqual({ date: "", time: "" })
  })
})

// A device in a time zone behind UTC (Los Angeles) must not move any date by a day.
describe("in a time zone behind UTC", () => {
  const zone = process.env.TZ
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles"
  })
  afterAll(() => {
    process.env.TZ = zone
  })

  it("is really behind UTC", () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBeGreaterThan(0)
  })

  it("turns a calendar day into YYYY-MM-DD and back without a shift", () => {
    for (const day of ["2026-01-01", "2026-02-28", "2026-03-31", "2026-11-01", "2026-12-31", "2028-02-29"]) {
      expect(isoOf(localOf(day))).toBe(day)
      expect(parseDayFirst(showDayFirst(day))).toBe(day)
    }
  })

  it("moves across a month end and a year end", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    // The clocks change on 1 November 2026 in Los Angeles.
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01")
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02")
  })

  it("finds a week's Monday, across a month end", () => {
    expect(mondayOf("2026-11-12")).toBe("2026-11-09")
    expect(mondayOf("2026-11-09")).toBe("2026-11-09")
    expect(mondayOf("2026-11-15")).toBe("2026-11-09")
    expect(mondayOf("2026-11-01")).toBe("2026-10-26")
  })
})
