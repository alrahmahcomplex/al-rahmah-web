import { describe, expect, it } from "vitest"

import { saveScheduleOutcome } from "@/app/staff/fees/outcome"

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
