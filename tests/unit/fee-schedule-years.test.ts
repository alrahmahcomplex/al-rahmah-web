import { describe, expect, it } from "vitest"

import { canReadFeeSchedule, canSeeFeeAmounts, parseScheduleYear } from "@/app/staff/fees/years"

describe("parseScheduleYear", () => {
  it("reads a four-digit year from 2000 to 2999", () => {
    expect(parseScheduleYear("2027")).toBe(2027)
    expect(parseScheduleYear(" 2000 ")).toBe(2000)
    expect(parseScheduleYear("2999")).toBe(2999)
  })

  it("refuses anything else", () => {
    for (const typed of ["", "1999", "3000", "27", "20271", "2027a", "2,027", "-2027"]) {
      expect(parseScheduleYear(typed), typed).toBeNull()
    }
  })
})

describe("canReadFeeSchedule", () => {
  it("opens to staff who may view payments or manage academic years, and no one else", () => {
    expect(canReadFeeSchedule(["payments.view"])).toBe(true)
    expect(canReadFeeSchedule(["academic_years.manage"])).toBe(true)
    expect(canReadFeeSchedule(["leads.view", "payments.record"])).toBe(false)
  })
})

describe("canSeeFeeAmounts", () => {
  it("needs payments.view, which the database requires to read amounts", () => {
    expect(canSeeFeeAmounts(["payments.view"])).toBe(true)
    expect(canSeeFeeAmounts(["academic_years.manage"])).toBe(false)
  })
})
