import { describe, expect, it } from "vitest"

import { clampWidth, sidebarLimits, titleSize, type SidebarMeasures } from "@/app/staff/_new-shell/sidebar-width"

// A 1280px window: 16px frame padding, labels at most 128px wide, the title
// 132px at 14px, a stage of 980px with the sidebar at 252px.
const AT_1280: SidebarMeasures = {
  rowPadding: 10,
  rowGap: 10,
  iconSize: 16,
  longestLabel: 128,
  framePadding: 16,
  titleLeft: 50,
  titleWidth: 132,
  pagePadding: 40,
  pageMax: 1180,
  stageAtBase: 980,
}

describe("sidebarLimits", () => {
  it("leaves the same gap after the longest label as before the icons", () => {
    // 10 + 16 + 10 + 128 + 16 + 10
    expect(sidebarLimits(AT_1280).min).toBe(190)
  })

  it("is held open by the title at its smallest size when the labels are short", () => {
    // 50 + 132 × 11 / 14 + 8 = 161.7
    expect(sidebarLimits({ ...AT_1280, longestLabel: 60 }).min).toBe(162)
  })

  it("lets the widest reach half way to the page column", () => {
    // The page column fills the stage at 1280px: the distance is the padding alone.
    expect(sidebarLimits(AT_1280).max).toBe(252 + 20)
    // On a 1920px window the column is centred: 40 + (1620 - 80 - 1180) / 2 = 220.
    expect(sidebarLimits({ ...AT_1280, stageAtBase: 1620 }).max).toBe(252 + 110)
  })

  it("never puts the widest below the narrowest", () => {
    const limits = sidebarLimits({ ...AT_1280, longestLabel: 400 })
    expect(limits.max).toBe(limits.min)
  })
})

describe("clampWidth", () => {
  const limits = { min: 190, max: 272 }
  it("holds a width within the limits, in whole pixels", () => {
    expect(clampWidth(100, limits)).toBe(190)
    expect(clampWidth(500, limits)).toBe(272)
    expect(clampWidth(230.4, limits)).toBe(230)
  })
  it("falls back to the narrowest for a width that is not a number", () => {
    expect(clampWidth(Number.NaN, limits)).toBe(190)
  })
})

describe("titleSize", () => {
  it("is 14px when the title fits and steps down to 11px", () => {
    expect(titleSize(260, 50, 132)).toBe(14)
    expect(titleSize(50 + 8 + 132 * (12 / 14), 50, 132)).toBeCloseTo(12)
    expect(titleSize(120, 50, 132)).toBe(11)
  })
})
