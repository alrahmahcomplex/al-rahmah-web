import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Icon as FormIcon } from "@/components/guided-form/icons"
import { Icon, ICONS, type IconName, type IconSize } from "@/components/icons"
import { icon } from "@/components/icons/registry"
import { Illustration } from "@/components/illustrations"

// DESIGN.md, Icons: the names of set 2, then the Admission form's own glyphs.
const SET_2 = [
  "today", "checkin", "register", "applicants", "interviews", "followups", "reapps", "agents", "promo", "groups", "fees",
  "seats", "discounts", "reopen", "reports", "roles", "audit", "search", "bell", "panel", "menu", "back", "right", "check",
  "plus", "x", "reset", "alert", "info", "phone", "user", "school", "link", "filter",
]
const FORM_ONLY = ["clock", "globe", "trash"]
// The form parts' glyphs (#358): one line, no circle.
const FORM_PARTS = ["down", "calendar", "upload"]
const UTILITY = ["back", "right", "check", "plus", "x"]
const names = Object.keys(ICONS) as IconName[]

// @ts-expect-error: the registry type rejects an icon without an outline.
icon({ detail: <path d="M0 0" /> })

describe("icon registry", () => {
  it("holds set 2 and the Admission form's glyphs, nothing else", () => {
    expect(names).toEqual([...SET_2, ...FORM_ONLY, ...FORM_PARTS])
  })

  it("gives every set 2 icon a circle except the utility glyphs, and the form's glyphs none", () => {
    for (const name of SET_2) expect(Boolean(ICONS[name as IconName].circle), name).toBe(!UTILITY.includes(name))
    for (const name of [...FORM_ONLY, ...FORM_PARTS]) expect(ICONS[name as IconName].circle, name).toBeUndefined()
  })

  it("keeps utility glyphs to one line", () => {
    for (const name of [...UTILITY, ...FORM_PARTS]) expect(ICONS[name as IconName].detail, name).toBeUndefined()
  })
})

describe("Icon", () => {
  it.each([16, 18, 20] as IconSize[])("renders every icon at %ipx", (size) => {
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} size={size} />)
      const svg = container.querySelector("svg")!
      expect(svg, name).toHaveAttribute("width", String(size))
      expect(svg).toHaveAttribute("height", String(size))
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24")
      expect(svg).toHaveAttribute("aria-hidden", "true")
      const layers = svg.querySelectorAll(":scope > g.gf-ic-line")
      expect(layers.length, name).toBe(ICONS[name].detail ? 2 : 1)
      for (const layer of layers) expect(layer.children.length, name).toBeGreaterThan(0)
      const glow = svg.querySelector(":scope > circle.gf-ic-glow")
      expect(Boolean(glow), name).toBe(Boolean(ICONS[name].circle))
      unmount()
    }
  })

  it("draws the circle first, under the lines, at the prototype's place", () => {
    const { container } = render(<Icon name="today" />)
    const glow = container.querySelector("svg")!.firstElementChild!
    expect(glow).toHaveClass("gf-ic-glow")
    expect(glow).toHaveAttribute("cx", "16")
    expect(glow).toHaveAttribute("cy", "16")
    expect(glow).toHaveAttribute("r", "6")
  })

  it("defaults to 20px and marks a featured icon", () => {
    const { container, rerender } = render(<Icon name="bell" />)
    expect(container.querySelector("svg")).toHaveAttribute("width", "20")
    expect(container.querySelector("svg")).not.toHaveAttribute("data-featured")
    rerender(<Icon name="bell" featured />)
    expect(container.querySelector("svg")).toHaveAttribute("data-featured")
  })
})

describe("the Admission form's Icon", () => {
  it("draws the same lines as the registry, with no circle and no wrapper", () => {
    for (const name of names) {
      const { container, unmount } = render(<FormIcon name={name} />)
      const svg = container.querySelector("svg")!
      expect(svg).toHaveClass("gf-icon")
      expect(svg.querySelector("circle.gf-ic-glow, g"), name).toBeNull()
      const staff = render(<Icon name={name} />)
      const layers = [...staff.container.querySelectorAll("g.gf-ic-line")]
      if (name === "menu") {
        // One path holding both layers' lines, as the form always drew it.
        const d = layers.map((g) => g.querySelector("path")!.getAttribute("d")).join("")
        expect(svg.innerHTML).toBe(`<path d="${d}"></path>`)
      } else expect(svg.innerHTML, name).toBe(layers.map((g) => g.innerHTML).join(""))
      staff.unmount()
      unmount()
    }
  })

  it("keeps its small size", () => {
    const { container } = render(<FormIcon name="check" small />)
    expect(container.querySelector("svg")).toHaveClass("gf-icon", "gf-s")
  })
})

describe("Illustration", () => {
  it.each([130, 140, 150] as const)("lays the scene out %ipx wide, decorative", (size) => {
    const { container } = render(<Illustration name="empty" size={size} />)
    const box = container.firstElementChild as HTMLElement
    expect(box.style.width).toBe(`${size}px`)
    const img = container.querySelector("img")!
    expect(img).toHaveAttribute("src", "/illustrations/empty.svg")
    expect(img).toHaveAttribute("alt", "")
    // The file's frame is 144 units for the prototype's 128-unit box.
    expect(Number(img.getAttribute("width"))).toBeCloseTo((size * 144) / 128)
    expect(img.style.marginLeft).toBe(`${(-8 * size) / 128}px`)
  })
})
