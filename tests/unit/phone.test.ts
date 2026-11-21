import { describe, expect, test } from "vitest"

import { normalizeTanzanianMobile, withoutPlus } from "@/lib/phone"

describe("normalizeTanzanianMobile", () => {
  test.each([
    ["0712 345 123", "+255712345123"],
    ["0654-888-210", "+255654888210"],
    ["255712345123", "+255712345123"],
    ["+255 754 888 210", "+255754888210"],
    ["(0712) 345.123", "+255712345123"],
    ["+255612000111", "+255612000111"],
  ])("reads %s as %s", (typed, stored) => {
    expect(normalizeTanzanianMobile(typed)).toBe(stored)
  })

  test.each([
    ["0222 123 456", "a landline"],
    ["0812 345 678", "not a 6 or 7 after the 0"],
    ["071234512", "nine digits"],
    ["07123451234", "eleven digits"],
    ["712345123", "no 0 in front"],
    ["+254712345123", "Kenya"],
    ["2557123451", "255 with too few digits"],
    ["", "nothing"],
    ["amina@mfano.com", "an email"],
  ])("refuses %s (%s)", (typed) => {
    expect(normalizeTanzanianMobile(typed)).toBeNull()
  })
})

test("withoutPlus drops a leading + only", () => {
  expect(withoutPlus("+255712345123")).toBe("255712345123")
  expect(withoutPlus("255712345123")).toBe("255712345123")
})
