import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// Every browser spec that opens a staff page runs under the console-error
// guard of e2e/staff-test.ts (#317).
const dir = join(process.cwd(), "e2e")
const specs = readdirSync(dir)
  .filter((name) => name.endsWith(".spec.ts"))
  .map((name) => ({ name, source: readFileSync(join(dir, name), "utf8") }))

describe("staff specs", () => {
  const staff = specs.filter(({ source }) => source.includes("/staff"))

  it("are found", () => {
    expect(staff.length).toBeGreaterThan(50)
  })

  it.each(staff.map(({ name, source }) => [name, source]))("%s takes test and expect from ./staff-test", (_name, source) => {
    expect(source).toMatch(/^import \{[^}]*\btest\b[^}]*\} from "\.\/staff-test"$/m)
    const playwright = source.match(/^import \{([^}]*)\} from "@playwright\/test"$/m)?.[1] ?? ""
    expect(playwright).not.toMatch(/(^|,)\s*(test|expect)\s*(,|$)/)
  })
})
