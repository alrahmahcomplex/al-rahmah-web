import { describe, expect, it } from "vitest"

import { formatCount, MIN_SHOWN_APPLICATIONS, shownApplicationCount } from "@/lib/live-apply"

describe("the application count the form states", () => {
  it("is left out when unknown or below 100", () => {
    expect(MIN_SHOWN_APPLICATIONS).toBe(100)
    for (const count of [null, 0, 99]) expect(shownApplicationCount(count)).toBeNull()
  })

  it("is the count itself from 100 up", () => {
    expect(shownApplicationCount(100)).toBe(100)
    expect(shownApplicationCount(1284)).toBe(1284)
  })

  it("groups thousands with commas", () => {
    expect(formatCount(100)).toBe("100")
    expect(formatCount(1284)).toBe("1,284")
    expect(formatCount(1234567)).toBe("1,234,567")
  })
})
