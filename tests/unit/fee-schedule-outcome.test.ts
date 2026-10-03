import { describe, expect, it } from "vitest"

import { academicYearOutcome, saveScheduleOutcome } from "@/app/staff/fees/outcome"

describe("saveScheduleOutcome", () => {
  it("names the band and Day or Boarding of a refused amount", () => {
    expect(saveScheduleOutcome({ kind: "invalid", field: "primary_upper.boarding_fee" })).toEqual({
      status: "refused",
      field: "primary_upper.boarding_fee",
      message: "Enter the Primary STD 5 to STD 7 Boarding fee in whole shillings, above zero.",
    })
    expect(saveScheduleOutcome({ kind: "invalid", field: "nursery.day_fee" })).toMatchObject({
      message: "Enter the Nursery Day fee in whole shillings, above zero.",
    })
  })

  it("says the split must add up to 100%", () => {
    expect(saveScheduleOutcome({ kind: "invalid", field: "split" })).toEqual({
      status: "refused",
      field: "split",
      message: "The three instalment shares must add up to 100%.",
    })
  })

  it("explains a share, a due date, the deposit and the Pre-Form One fees", () => {
    expect(saveScheduleOutcome({ kind: "invalid", field: "second_share" })).toMatchObject({
      message: "Enter the second instalment's share as a whole percentage above zero.",
    })
    expect(saveScheduleOutcome({ kind: "invalid", field: "third_due" })).toMatchObject({
      message: "Enter the third instalment's due date, on or after the second's.",
    })
    expect(saveScheduleOutcome({ kind: "invalid", field: "minimum_deposit" })).toMatchObject({
      message: "Enter the minimum Initial deposit in whole shillings, above zero.",
    })
    expect(saveScheduleOutcome({ kind: "invalid", field: "pre_form_one_boarding_fee" })).toMatchObject({
      message: "Enter the Pre-Form One programme Boarding fee in whole shillings, above zero.",
    })
  })

  it("falls back to a general sentence for a field it doesn't know", () => {
    expect(saveScheduleOutcome({ kind: "invalid", field: null })).toEqual({
      status: "refused",
      field: null,
      message: "Some amounts could not be accepted. Check them and try again.",
    })
  })

  it("says when the role can't change amounts, and when nothing could be saved", () => {
    expect(saveScheduleOutcome({ kind: "forbidden" })).toMatchObject({ message: "Your role can't change the fee amounts." })
    expect(saveScheduleOutcome({ kind: "unavailable" })).toMatchObject({
      message: "The schedule could not be saved. Nothing was changed. Try again in a moment.",
    })
  })
})

describe("academicYearOutcome", () => {
  it("asks for a date in January of the year", () => {
    expect(academicYearOutcome({ kind: "invalid", field: "academic_year_start" }, 2027)).toEqual({
      status: "refused",
      field: "academic_year_start",
      message: "Choose an Academic-year start in January 2027. Once set, it can be changed but not cleared.",
    })
  })

  it("names the class and Day or Boarding of a refused seat count", () => {
    expect(academicYearOutcome({ kind: "invalid", field: "seats.STD 3.Boarding" }, 2027)).toEqual({
      status: "refused",
      field: "seats.STD 3.Boarding",
      message: "Enter the STD 3 Boarding seats as a whole number, 0 or more. Once set, seats can be changed but not cleared.",
    })
  })

  it("falls back to a general sentence for the seat list or a field it doesn't know", () => {
    for (const field of ["seats", null] as const) {
      expect(academicYearOutcome({ kind: "invalid", field }, 2027)).toMatchObject({
        message: "Some seat numbers could not be accepted. Check them and try again.",
      })
    }
  })

  it("says when the year has no schedule, the role can't set it, or nothing could be saved", () => {
    expect(academicYearOutcome({ kind: "stale", field: "seats.STD 1.Day" }, 2027)).toEqual({
      status: "refused",
      field: "seats.STD 1.Day",
      stale: true,
      message:
        "Someone else changed the start or seats while you were editing. Cancel to see their change, then make yours again.",
    })
    expect(academicYearOutcome({ kind: "no-schedule" }, 2027)).toMatchObject({
      message: "The 2027 Fee schedule hasn't been created yet. The Accountant creates it first.",
    })
    expect(academicYearOutcome({ kind: "forbidden" }, 2027)).toMatchObject({
      message: "Your role can't set the Academic-year start or seats.",
    })
    expect(academicYearOutcome({ kind: "unavailable" }, 2027)).toMatchObject({
      message: "The start and seats could not be saved. Try again in a moment.",
    })
  })
})
