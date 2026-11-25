import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Icon as FormIcon } from "@/components/guided-form/icons"
import { Icon, ICONS, type IconName, type IconSize } from "@/components/icons"
import { icon } from "@/components/icons/registry"
import { Illustration, ILLUSTRATION_NAMES } from "@/components/illustrations"

// DESIGN.md, Icons: the names of set 1, then the Admission form's own glyphs.
const SET_1 = [
  "today", "checkin", "register", "applicants", "interviews", "followups", "reapps", "agents", "promo", "groups", "fees",
  "seats", "discounts", "reopen", "reports", "roles", "audit", "search", "bell", "panel", "menu", "back", "right", "check",
  "plus", "x", "reset", "alert", "info", "phone", "user", "school", "house", "link", "filter",
]
const FORM_ONLY = ["clock", "globe", "trash"]
// The form parts' glyphs (#358); the calendar has two lines since v38.
const FORM_PARTS = ["down", "calendar", "upload"]
// Seats' streams (#449, prototype v42): bring up, and the pencil on a stream.
const STREAMS = ["up", "pen"]
// The previous school's region field (#511, prototype v53).
const PLACES = ["pin"]
// The agents app's glyphs (#539, prototype v5).
const AGENTS_APP = ["copy", "chat", "signout"]
// The agent sign-up's step discs (prototype v5, 25 Nov 2026).
const SIGN_UP = ["lock", "mail", "smscode"]
const ONE_LINE = ["back", "right", "check", "plus", "x", "phone", "down", "upload", "up"]
const names = Object.keys(ICONS) as IconName[]

// @ts-expect-error: the registry type rejects an icon without an outline.
icon({ detail: <path d="M0 0" /> })

describe("icon registry", () => {
  it("holds set 1, the Admission form's glyphs, the streams' two, the region pin, the agents app glyphs and the sign-up discs, nothing else", () => {
    expect(names).toEqual([...SET_1, ...FORM_ONLY, ...FORM_PARTS, ...STREAMS, ...PLACES, ...AGENTS_APP, ...SIGN_UP])
  })

  it("gives every icon a second line except the one-line glyphs", () => {
    for (const name of names) expect(Boolean(ICONS[name].detail), name).toBe(!ONE_LINE.includes(name))
  })

  it("draws the house as the prototype's Home entry", () => {
    expect(render(<Icon name="house" />).container.innerHTML).toBe(render(<Icon name="school" />).container.innerHTML)
  })
})

describe("Icon", () => {
  it.each([16, 18, 20, 24] as IconSize[])("renders every icon at %ipx", (size) => {
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} size={size} />)
      const svg = container.querySelector("svg")!
      expect(svg, name).toHaveAttribute("width", String(size))
      expect(svg).toHaveAttribute("height", String(size))
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24")
      expect(svg).toHaveAttribute("aria-hidden", "true")
      // Set 1: the main line, then the detail in its own layer; no soft shape behind them.
      const main = svg.querySelectorAll(":scope > g.gf-ic-line")
      const detail = svg.querySelectorAll(":scope > g.gf-ic-detail")
      expect(main.length, name).toBe(1)
      expect(detail.length, name).toBe(ICONS[name].detail ? 1 : 0)
      expect(svg.children.length, name).toBe(main.length + detail.length)
      for (const layer of [...main, ...detail]) expect(layer.children.length, name).toBeGreaterThan(0)
      unmount()
    }
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
  it("draws the same lines as the registry, with no layers", () => {
    for (const name of names) {
      const { container, unmount } = render(<FormIcon name={name} />)
      const svg = container.querySelector("svg")!
      expect(svg).toHaveClass("gf-icon")
      expect(svg.querySelector("g"), name).toBeNull()
      const staff = render(<Icon name={name} />)
      const layers = [...staff.container.querySelectorAll("g.gf-ic-line, g.gf-ic-detail")]
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
  it("has the six style C pictures of prototype v38", () => {
    expect(ILLUSTRATION_NAMES).toEqual(["search", "done", "inbox", "finding", "sending", "oops"])
  })

  it.each([120, 132, 150, 170])("draws each picture inline at %ipx wide, five sixths as tall, decorative", (size) => {
    for (const name of ILLUSTRATION_NAMES) {
      const { container, unmount } = render(<Illustration name={name} size={size} />)
      const svg = container.querySelector("svg")!
      expect(svg, name).toHaveAttribute("width", String(size))
      expect(svg).toHaveAttribute("height", String(Math.round((size * 100) / 120)))
      expect(svg).toHaveAttribute("viewBox", "0 0 120 100")
      expect(svg).toHaveAttribute("aria-hidden", "true")
      // Every picture sits on the soft circle, and none is an image file.
      expect(svg.firstElementChild).toHaveClass("ill-bg")
      expect(container.querySelector("img")).toBeNull()
      unmount()
    }
  })
})
