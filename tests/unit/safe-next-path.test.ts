import { describe, expect, it } from "vitest"

import { safeNextPath } from "@/lib/safe-next-path"

describe("safeNextPath", () => {
  it.each([
    ["/staff", "/staff"],
    ["/staff/leads?tab=overdue", "/staff/leads?tab=overdue"],
  ])("keeps the same-site path %s", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected)
  })

  it.each([
    [null],
    [""],
    ["staff"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["@evil.example"],
    ["https://evil.example/staff"],
  ])("falls back to /staff for %s", (next) => {
    expect(safeNextPath(next)).toBe("/staff")
  })
})
