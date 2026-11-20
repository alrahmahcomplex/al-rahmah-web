import { render } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { LogoLoader } from "@/components/brand/logo-loader"
import { LogoMark } from "@/components/brand/logo-mark"

// The emblem at rest and loading. Motion itself can't be watched in jsdom, so the
// reduced-motion tests read the CSS module the classes come from.

const css = (file: string) => readFileSync(join(process.cwd(), file), "utf8")

// The rules inside `@media (prefers-reduced-motion: reduce) { … }`.
function reducedMotionRules(source: string): string {
  const start = source.indexOf("@media (prefers-reduced-motion: reduce)")
  expect(start, "the module has a reduced-motion block").toBeGreaterThan(-1)
  return source.slice(start)
}

describe("LogoMark", () => {
  it("draws the emblem without the lettering, hidden from screen readers", () => {
    const { container } = render(<LogoMark size={48} />)
    const svg = container.querySelector("svg")!
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg).toHaveAttribute("width", "48")
    expect(svg).toHaveAttribute("height", String(Math.round(48 * (470.18 / 822.36))))
    // The globe's ten orange segments and the book's five indigo shapes.
    expect(container.querySelectorAll("path[fill='#ef8e35']")).toHaveLength(10)
    expect(container.querySelectorAll("path[fill='#2408b2']")).toHaveLength(5)
    expect(container.querySelectorAll("path")).toHaveLength(15)
  })
})

describe("LogoLoader", () => {
  it("is the same emblem, hidden from screen readers, with its parts classed for the animation", () => {
    const { container } = render(<LogoLoader />)
    const svg = container.querySelector("svg")!
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg.getAttribute("class")).toMatch(/loader/)
    expect(container.querySelectorAll("path")).toHaveLength(15)
    // Four pages open from the spine; the cover stays put.
    const pages = [...container.querySelectorAll("path[data-side='left'], path[data-side='right']")]
    expect(pages).toHaveLength(4)
    pages.forEach((page) => expect(page.getAttribute("class")).toMatch(/page/))
    expect(container.querySelector("path[data-side='cover']")?.getAttribute("class")).toBeFalsy()
    // The globe lights in five beats, a pair at a time.
    const beats = [...container.querySelectorAll("path[data-beat]")].map((segment) => segment.getAttribute("data-beat"))
    expect(beats.toSorted()).toEqual(["0", "0", "1", "1", "2", "2", "3", "3", "4", "4"])
    expect(container.querySelector("g")?.getAttribute("class")).toMatch(/breath/)
  })

  it("stands still with reduced motion, keeping only a soft pulse", () => {
    const rules = reducedMotionRules(css("components/brand/logo-loader.module.css"))
    expect(rules).toMatch(/\.page,\s*\.segment\s*\{\s*animation:\s*none/)
    expect(rules).toMatch(/\.breath\s*\{\s*animation:\s*still-pulse/)
    expect(css("components/brand/logo-loader.module.css")).toMatch(/@keyframes still-pulse\s*\{[^@]*opacity/)
  })
})
