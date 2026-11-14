// Which shell each staff route is drawn in (#316): "new" for a route the
// redesign has converted whole, "legacy" for one that keeps the old look. A
// screen is never half-converted, so a route moves to "new" in the same PR
// that restyles it with the kit.
//
// Every page.tsx under app/staff/ has its pattern here (a unit test fails on
// one that is missing). scripts/design-lint.mjs and eslint.config.mjs read
// the "new" entries straight from this file, so keep each entry as
// `"/staff/x": "new" | "legacy"`. No imports: the client shell, the lint and
// the tests all read it.

export type Look = "new" | "legacy"

export const ROUTE_LOOKS = {
  "/staff": "legacy",
  "/staff/[...rest]": "legacy",
  "/staff/agents": "legacy",
  "/staff/agents/import": "legacy",
  "/staff/applicants": "legacy",
  "/staff/applicants/[id]": "legacy",
  "/staff/applicants/[id]/history": "legacy",
  "/staff/applicants/[id]/reopen": "legacy",
  "/staff/audit": "legacy",
  "/staff/check-in": "legacy",
  "/staff/check-in/new": "legacy",
  "/staff/discounts": "legacy",
  "/staff/fees": "new",
  "/staff/fees/[year]": "new",
  "/staff/follow-ups": "legacy",
  "/staff/group-links": "legacy",
  "/staff/interviews": "legacy",
  "/staff/kit": "new",
  "/staff/promo-codes": "legacy",
  "/staff/re-applications": "legacy",
  "/staff/re-applications/[id]": "legacy",
  "/staff/reopenings": "new",
  "/staff/reports": "legacy",
  "/staff/roles": "legacy",
  "/staff/seats": "new",
} as const satisfies Record<string, Look>

// How closely a pattern's segment fits: a fixed name beats `[id]`, which
// beats a catch-all, as Next.js itself picks the route.
const FIXED = 3
const DYNAMIC = 2
const CATCH_ALL = 1

/** How each segment of `pattern` fits `pathname`, or null when it does not match. */
function fit(pattern: string, segments: readonly string[]): number[] | null {
  const parts = pattern.split("/").filter(Boolean)
  const scores: number[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.startsWith("[[...")) return [...scores, CATCH_ALL - 1]
    if (part.startsWith("[...")) return i < segments.length ? [...scores, CATCH_ALL] : null
    if (i >= segments.length) return null
    if (part.startsWith("[")) scores.push(DYNAMIC)
    else if (part === segments[i]) scores.push(FIXED)
    else return null
  }
  return parts.length === segments.length ? scores : null
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/**
 * The route pattern a staff path belongs to, matched exactly: `/staff` is
 * only the home, and `/staff/check-in` and `/staff/check-in/new` are two
 * routes. Undefined outside /staff.
 */
export function routeFor(pathname: string): keyof typeof ROUTE_LOOKS | undefined {
  const segments = pathname.split("/").filter(Boolean)
  let best: { pattern: keyof typeof ROUTE_LOOKS; scores: number[] } | undefined
  for (const pattern of Object.keys(ROUTE_LOOKS) as (keyof typeof ROUTE_LOOKS)[]) {
    const scores = fit(pattern, segments)
    if (scores && (!best || better(scores, best.scores))) best = { pattern, scores }
  }
  return best?.pattern
}

/** The shell a staff path is drawn in; "legacy" for anything the map does not name. */
export function lookFor(pathname: string): Look {
  const pattern = routeFor(pathname)
  return pattern ? ROUTE_LOOKS[pattern] : "legacy"
}
