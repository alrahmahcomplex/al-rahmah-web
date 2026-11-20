import { existsSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

import { ROUTE_LOOKS } from "@/app/staff/route-looks"

const STAFF = join(process.cwd(), "app", "staff")

// Every page under app/staff/, as the route pattern Next.js serves it from:
// app/staff/applicants/[id]/page.tsx is /staff/applicants/[id]. Route
// groups add nothing to the path; private folders hold no routes.
function pagePatterns(dir = STAFF): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!name.startsWith("_")) out.push(...pagePatterns(path))
    } else if (name === "page.tsx") {
      const parts = relative(join(process.cwd(), "app"), dir).split(sep).filter((part) => !/^\(.*\)$/.test(part))
      out.push(`/${parts.join("/")}`)
    }
  }
  return out.sort()
}

describe("the staff route map", () => {
  it("classifies every staff page.tsx, so design-lint finds every staff route's files", () => {
    const pages = pagePatterns()
    expect(pages.length).toBeGreaterThan(20)
    expect(pages.filter((pattern) => !(pattern in ROUTE_LOOKS))).toEqual([])
  })

  it("gives every route but Home its own loading.tsx, so none falls back to Home's new-look skeleton (#323)", () => {
    const missing = Object.keys(ROUTE_LOOKS)
      .filter((pattern) => pattern !== "/staff")
      .filter((pattern) => !existsSync(join(process.cwd(), "app", ...pattern.split("/").filter(Boolean), "loading.tsx")))
    expect(missing).toEqual([])
  })

  it("names no route that has no page", () => {
    const pages = new Set(pagePatterns())
    expect(Object.keys(ROUTE_LOOKS).filter((pattern) => !pages.has(pattern))).toEqual([])
  })

  it("draws every route in the new shell: the old one is gone (#332)", () => {
    expect(Object.entries(ROUTE_LOOKS).filter(([, look]) => look !== "new")).toEqual([])
  })
})
