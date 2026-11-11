import { readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

import { lookFor, ROUTE_LOOKS, routeFor } from "@/app/staff/route-looks"

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
  it("classifies every staff page.tsx, so a new page cannot land in a shell by accident", () => {
    const pages = pagePatterns()
    expect(pages.length).toBeGreaterThan(20)
    expect(pages.filter((pattern) => !(pattern in ROUTE_LOOKS))).toEqual([])
  })

  it("names no route that has no page", () => {
    const pages = new Set(pagePatterns())
    expect(Object.keys(ROUTE_LOOKS).filter((pattern) => !pages.has(pattern))).toEqual([])
  })

  it("puts only the kit page and Reopening requests in the new shell (#322)", () => {
    expect(Object.entries(ROUTE_LOOKS).filter(([, look]) => look === "new").map(([pattern]) => pattern)).toEqual(["/staff/kit", "/staff/reopenings"])
  })
})

describe("routeFor and lookFor", () => {
  it("matches exactly: /staff is only the home", () => {
    expect(routeFor("/staff")).toBe("/staff")
    expect(lookFor("/staff")).toBe("legacy")
    expect(lookFor("/staff/kit")).toBe("new")
    expect(lookFor("/staff/reopenings")).toBe("new")
  })

  it("keeps a page and the page beneath it apart", () => {
    expect(routeFor("/staff/check-in")).toBe("/staff/check-in")
    expect(routeFor("/staff/check-in/new")).toBe("/staff/check-in/new")
  })

  it("fills a dynamic segment, and prefers a fixed name to it", () => {
    expect(routeFor("/staff/applicants/1ead0000-0000-4000-8000-000000000080")).toBe("/staff/applicants/[id]")
    expect(routeFor("/staff/applicants/abc/history")).toBe("/staff/applicants/[id]/history")
    expect(routeFor("/staff/fees/2027")).toBe("/staff/fees/[year]")
  })

  it("sends anything else under /staff to the catch-all, in the old shell", () => {
    expect(routeFor("/staff/reopenings/extra")).toBe("/staff/[...rest]")
    expect(routeFor("/staff/nowhere/at/all")).toBe("/staff/[...rest]")
    expect(lookFor("/staff/reopenings/extra")).toBe("legacy")
  })

  it("draws the old shell for a path outside the map", () => {
    expect(routeFor("/login")).toBeUndefined()
    expect(lookFor("/login")).toBe("legacy")
    expect(lookFor("")).toBe("legacy")
  })

  it("ignores a trailing slash", () => {
    expect(lookFor("/staff/kit/")).toBe("new")
  })
})
