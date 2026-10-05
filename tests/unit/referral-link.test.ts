import { describe, expect, it } from "vitest"

import {
  DISCOUNT_CODE_COOKIE,
  DISCOUNT_CODE_MAX_AGE,
  discountCodeCookie,
  initialDiscountCode,
  normalizeDiscountCode,
} from "@/lib/referral-link"

describe("normalizeDiscountCode", () => {
  it.each([
    ["ABC-123", "ABC-123"],
    ["abc-123", "ABC-123"],
    [" ABC-123 ", "ABC-123"],
    ["ABC -123", "ABC-123"],
    ["a b c.1", "ABC.1"],
    ["X", "X"],
    ["ABCDEFGHIJ-123456789", "ABCDEFGHIJ-123456789"],
  ])("reads %j as %j, as the database does", (typed, code) => {
    expect(normalizeDiscountCode(typed)).toBe(code)
  })

  it.each([
    ["", "empty"],
    ["   ", "only spaces"],
    ["ABC_123", "an underscore"],
    ["ABC/123", "a slash"],
    ["ABC-1234567890ABCDEFG", "21 characters"],
    ["ÄBC-123", "a letter outside A to Z"],
    ["<script>", "markup"],
  ])("refuses %j (%s)", (typed) => {
    expect(normalizeDiscountCode(typed)).toBeNull()
  })

  it("refuses anything that isn't a single string", () => {
    expect(normalizeDiscountCode(undefined)).toBeNull()
    expect(normalizeDiscountCode(null)).toBeNull()
    expect(normalizeDiscountCode(["ABC-123", "DEF-456"])).toBeNull()
    expect(normalizeDiscountCode(123)).toBeNull()
  })
})

describe("discountCodeCookie", () => {
  it("holds only the code, for 30 days, on every path, SameSite=Lax and readable by the page", () => {
    const cookie = discountCodeCookie("BJN-402", { secure: false })
    expect(cookie).toBe(`${DISCOUNT_CODE_COOKIE}=BJN-402; Max-Age=2592000; Path=/; SameSite=Lax`)
    expect(DISCOUNT_CODE_MAX_AGE).toBe(30 * 24 * 60 * 60)
    expect(cookie).not.toMatch(/HttpOnly/i)
  })

  it("is Secure on an https page", () => {
    expect(discountCodeCookie("BJN-402", { secure: true })).toBe(
      `${DISCOUNT_CODE_COOKIE}=BJN-402; Max-Age=2592000; Path=/; SameSite=Lax; Secure`,
    )
  })
})

describe("initialDiscountCode", () => {
  it("takes the link's code over the remembered one", () => {
    expect(initialDiscountCode({ ref: "bjn-402", cookie: "ZNM-401" })).toEqual({ code: "BJN-402", remember: "BJN-402" })
  })

  it("falls back to the remembered code when the visit has no link", () => {
    expect(initialDiscountCode({ ref: undefined, cookie: "ZNM-401" })).toEqual({ code: "ZNM-401", remember: null })
  })

  it("ignores a link whose code isn't a code, keeping the remembered one", () => {
    expect(initialDiscountCode({ ref: "not a code!", cookie: "ZNM-401" })).toEqual({ code: "ZNM-401", remember: null })
  })

  it("ignores a link carrying ref twice", () => {
    expect(initialDiscountCode({ ref: ["BJN-402", "ZNM-401"], cookie: undefined })).toEqual({ code: "", remember: null })
  })

  it("ignores a remembered value that isn't a code", () => {
    expect(initialDiscountCode({ ref: undefined, cookie: "%3Cscript%3E" })).toEqual({ code: "", remember: null })
  })

  it("starts empty with neither", () => {
    expect(initialDiscountCode({ ref: undefined, cookie: undefined })).toEqual({ code: "", remember: null })
  })
})
