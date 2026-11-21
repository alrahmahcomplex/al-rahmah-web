import { describe, expect, it } from "vitest"

import { currentAdmissionYear, defaultSeatsYear, tanzaniaToday } from "@/lib/school-calendar"

describe("currentAdmissionYear", () => {
  it("returns the calendar year before 1 June and next year from 1 June, in Tanzania time", () => {
    expect(currentAdmissionYear("2026-01-01")).toBe(2026)
    expect(currentAdmissionYear("2026-05-31")).toBe(2026)
    expect(currentAdmissionYear("2026-06-01")).toBe(2027)
    expect(currentAdmissionYear("2026-12-31")).toBe(2027)
    expect(currentAdmissionYear("2027-01-01")).toBe(2027)
  })

  it("switches at midnight in Tanzania (UTC+3), not UTC", () => {
    // 20:59 UTC on 31 May is 23:59 in Tanzania (still 31 May -> 2026).
    expect(currentAdmissionYear(tanzaniaToday(new Date("2026-05-31T20:59:59Z")))).toBe(2026)
    // 21:00 UTC on 31 May is 00:00 on 1 June in Tanzania (-> 2027).
    expect(currentAdmissionYear(tanzaniaToday(new Date("2026-05-31T21:00:00Z")))).toBe(2027)
    // Across New Year's midnight in Tanzania, 2027 stays 2027.
    expect(currentAdmissionYear(tanzaniaToday(new Date("2026-12-31T20:59:59Z")))).toBe(2027)
    expect(currentAdmissionYear(tanzaniaToday(new Date("2026-12-31T21:00:00Z")))).toBe(2027)
  })
})

describe("defaultSeatsYear", () => {
  it("opens on the latest Fee schedule up to the current admission year, or the earliest when all are later", () => {
    // Before 1 June: current admission year is 2026.
    expect(defaultSeatsYear([2026, 2027, 2028], "2026-05-31")).toBe(2026)
    expect(defaultSeatsYear([2025, 2027], "2026-05-31")).toBe(2025)
    expect(defaultSeatsYear([2027, 2028], "2026-05-31")).toBe(2027)

    // From 1 June: current admission year is 2027.
    expect(defaultSeatsYear([2026, 2027, 2028], "2026-06-01")).toBe(2027)
    expect(defaultSeatsYear([2026, 2027, 2028], "2026-12-31")).toBe(2027)
    expect(defaultSeatsYear([2026, 2027, 2028], "2027-01-01")).toBe(2027)
    expect(defaultSeatsYear([2024, 2025], "2026-06-01")).toBe(2025)
    expect(defaultSeatsYear([2030, 2029], "2026-06-01")).toBe(2029)
    expect(defaultSeatsYear([], "2026-06-01")).toBeNull()
  })
})
