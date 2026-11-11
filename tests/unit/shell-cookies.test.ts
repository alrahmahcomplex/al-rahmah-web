import { describe, expect, it } from "vitest"

import { clearedSidebarCookie, parseSidebarCookies, SIDEBAR_WIDTH_BOUNDS, sidebarCookie } from "@/app/staff/shell-cookies"

describe("parseSidebarCookies", () => {
  it("reads the fold only from an exact 1", () => {
    expect(parseSidebarCookies("1", undefined).folded).toBe(true)
    for (const rail of [undefined, "", "0", "true", " 1", "11"]) expect(parseSidebarCookies(rail, undefined).folded).toBe(false)
  })

  it("reads a width in whole pixels", () => {
    expect(parseSidebarCookies(undefined, "212").width).toBe(212)
    expect(parseSidebarCookies(undefined, "212.6").width).toBe(213)
    expect(parseSidebarCookies(undefined, " 230 ").width).toBe(230)
  })

  it("means the narrowest for no, an empty or a broken width", () => {
    for (const width of [undefined, "", "NaN", "abc", "12px", "-200", "0", "Infinity", "1e3", "0x100"])
      expect(parseSidebarCookies(undefined, width).width).toBeNull()
  })

  it("clamps a width outside the server's range", () => {
    expect(parseSidebarCookies(undefined, "40").width).toBe(SIDEBAR_WIDTH_BOUNDS.min)
    expect(parseSidebarCookies(undefined, "99999").width).toBe(SIDEBAR_WIDTH_BOUNDS.max)
    expect(parseSidebarCookies(undefined, "99999999999").width).toBeNull()
  })
})

describe("the cookie strings", () => {
  it("keeps a sidebar cookie for a year on every path, and clears it", () => {
    expect(sidebarCookie("staff-sidebar-width", "212")).toBe("staff-sidebar-width=212; path=/; max-age=31536000; samesite=lax")
    expect(clearedSidebarCookie("staff-sidebar-width")).toBe("staff-sidebar-width=; path=/; max-age=0; samesite=lax")
  })
})
