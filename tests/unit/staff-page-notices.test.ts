import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

const STAFF = join(process.cwd(), "app", "staff")

function sourceFiles(dir = STAFF): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

// Every staff route renders inside the Suspense boundary of its own
// loading.tsx, which has streamed by the time the page has awaited anything.
// A forbidden() or notFound() then fails that boundary on the server, and
// React reports error #419 when the person leaves the page (#437, #441). The
// pages return <StaffForbidden /> or <StaffNotFound /> instead.
describe("the staff pages' notices", () => {
  it("are returned, never thrown with forbidden() or notFound()", () => {
    const throwing = sourceFiles()
      .filter((file) => /import\s*\{[^}]*\b(forbidden|notFound)\b[^}]*\}\s*from\s*"next\/navigation"/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file).replaceAll("\\", "/"))
    expect(throwing).toEqual([])
  })
})
