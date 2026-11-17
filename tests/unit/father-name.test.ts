import { describe, expect, test } from "vitest"

import { fatherNameMatch, normalizeFatherName, wordEditDistance } from "@/lib/father-name"

// The database's own examples (tests/integration/father-full-name.test.ts),
// so the form asks the question the database would.
describe("the father's-name check, as the database runs it", () => {
  test.each([
    ["Mohamed", "Mohammed", "close"],
    ["Abdallah", "Abdalla", "close"],
    ["Ali", "Abu", "different"],
    ["Mohamed", "Muhammad", "different"],
    ["Mohamed Ali", "mohamed  ali.", "same"],
    ["Ali Hassan Mohamed", "Ali Hassan", "close"],
    ["Juma Ali", "Juma", "different"],
    ["  ABDUL-RAHMAN   O'Brien, ", "abdulrahman obrien", "same"],
    ["Hassan Ali", "Hassan Ali’", "same"],
    ["Mohamed", "Mohaemd", "close"],
    ["Mohamed Hassan", "Mohammed Hasan", "close"],
    ["Mohamed Hassan Juma", "Mohammed Hasan Jumaa", "different"],
    ["Juma", "Jumaa", "close"],
    ["Ali", "Alibu", "different"],
    ["Omar", "Amir", "different"],
    ["Ali Hassan", "Ali Hussein", "different"],
    ["Hassan Ali", "Ali Hassan", "different"],
    ["Ali Hassan", "Ali Hassan Mohamed", "close"],
    ["Ali Hassan Mohamed Juma", "Ali Hassan Mohamed", "close"],
    ["Ali Hassan Mohamed", "Ali Hasan", "different"],
    ["Hassan Ali Mohamed", "Ali Mohamed", "different"],
    ["Ali Hassan Mohamed Juma", "Ali Hassan", "different"],
    ["ALI MOHAMED", "ALI HASSAN MOHAMED", "close"],
    ["Ali Mohamed", "ALI HASSAN MOHAMED", "close"],
    ["Ali Hassan Juma", "Ali Hassan Mohamed Juma", "close"],
    ["Ali Juma", "Ali Hassan Mohamed Juma", "different"],
    ["Ali Mohamed", "Ali Hassan Mohamedi", "different"],
    ["Ali", "Ali Hassan", "different"],
  ])("%s against %s is %s", (a, b, expected) => {
    expect(fatherNameMatch(a, b)).toBe(expected)
    expect(fatherNameMatch(b, a)).toBe(expected)
  })

  test("a missing name is neither a match nor a mismatch", () => {
    expect(fatherNameMatch("", "Ali Hassan")).toBeNull()
    expect(fatherNameMatch("Ali", null)).toBeNull()
    expect(normalizeFatherName(" - . ")).toBeNull()
  })

  test("word distance counts a swap of neighbours as 1", () => {
    expect(wordEditDistance("ca", "ac")).toBe(1)
    expect(wordEditDistance("abc", "ca")).toBe(3)
    expect(wordEditDistance("", "abc")).toBe(3)
  })
})
