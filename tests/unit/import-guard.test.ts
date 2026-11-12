// @vitest-environment node
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"

import { config, convertedFiles } from "../../eslint.config.mjs"

// The ESLint guard of converted staff routes (#322, eslint.config.mjs): a
// route marked "new" in app/staff/route-looks.ts, and the new shell itself,
// may not import the old parts, however the import is spelled. A legacy
// route may.

const eslint = new ESLint({ cwd: process.cwd() })

async function restricted(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath })
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message.split(" import is restricted")[0])
}

const OLD_IMPORTS = [
  `import { XIcon } from "lucide-react"`,
  `import { Button } from "@/components/ui/button"`,
  `import { Button } from "../../../components/ui/button"`,
  `import { EmptyState } from "@/components/staff/empty-state"`,
  `import { EmptyState } from "../../components/staff/empty-state"`,
  `import { StatusChip } from "@/components/status-chip"`,
  `import { StatusChip } from "../../components/status-chip"`,
  `import { LegacyShell } from "../_shell/staff-shell"`,
  `import { LegacyShell } from "@/app/staff/_shell/staff-shell"`,
  `import { toast } from "sonner"`,
]

const lstatSafe = (path: string) => {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

const source = (line: string) => `${line}\nexport const used = [${line.match(/\{ (\w+) \}/)![1]}]\n`

describe("the import guard", () => {
  it.each(OLD_IMPORTS)("refuses %s in a converted route and in the new shell", async (line) => {
    expect(await restricted("app/staff/reopenings/page.tsx", source(line))).toHaveLength(1)
    expect(await restricted("app/staff/_new-shell/new-shell.tsx", source(line))).toHaveLength(1)
  })

  it.each(OLD_IMPORTS)("allows %s in a legacy route", async (line) => {
    expect(await restricted("app/staff/discounts/page.tsx", source(line))).toEqual([])
  })

  // A route folder with brackets is a literal name, not a glob (#360). No
  // such route is "new" yet, so the test marks three of them new in a copy
  // of the route map and lints their real files with that config.
  it.each([
    ["/staff/applicants/[id]", "app/staff/applicants/[id]/page.tsx"],
    ["/staff/fees/[year]", "app/staff/fees/[year]/page.tsx"],
    ["/staff/[...rest]", "app/staff/[...rest]/page.tsx"],
  ])("refuses an old part in %s once it is marked new", async (route, filePath) => {
    const map = readFileSync("app/staff/route-looks.ts", "utf8")
    const legacy = `"${route}": "legacy"`
    expect(map).toContain(legacy)
    const marked = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      overrideConfig: config(map.replace(legacy, `"${route}": "new"`)),
    })
    const [result] = await marked.lintText(source(OLD_IMPORTS[0]), { filePath })
    expect(result.messages.filter((m) => m.ruleId === "no-restricted-imports")).toHaveLength(1)
    // As the map stands, the route is legacy and may still import it.
    expect(await restricted(filePath, source(OLD_IMPORTS[0]))).toEqual([])
  })

  // Every Next.js folder name that is also glob syntax, in a checkout of the
  // test's own: each file of the "new" route is covered by its exact path,
  // and a file a glob made from those names would also match is not.
  it("covers a new route's files whatever glob syntax their names hold", () => {
    const base = mkdtempSync(join(tmpdir(), "import-guard-"))
    try {
      const route = ["app", "staff", "demo", "[id]"]
      const inside = [
        [...route, "page.tsx"],
        [...route, "@(dialog).tsx"],
        [...route, "+(x).tsx"],
        [...route, "a{b,c}.tsx"],
        [...route, "(group)", "panel.tsx"],
        [...route, "@slot", "panel.tsx"],
      ]
      const outside = [
        ["app", "staff", "demo", "i", "page.tsx"],
        ["app", "staff", "demo", "[id]", "nested", "page.tsx"],
      ]
      for (const parts of [...inside, ...outside]) {
        mkdirSync(join(base, ...parts.slice(0, -1)), { recursive: true })
        writeFileSync(join(base, ...parts), "export {}\n")
      }
      const map = `export const ROUTE_LOOKS = { "/staff/demo/[id]": "new", "/staff/demo/i": "legacy", "/staff/demo/[id]/nested": "legacy" }\n`
      const matches = convertedFiles(map, base).find((entry) => typeof entry === "function")!
      for (const parts of inside) expect(matches(join(base, ...parts)), parts.join("/")).toBe(true)
      for (const parts of outside) expect(matches(join(base, ...parts)), parts.join("/")).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  // Node loads eslint.config.mjs by its real path; ESLint names the files
  // through the folder it was started in. Through a junction (a symlink off
  // Windows) the two differ, and the guard must still apply.
  it("refuses an old part in a converted route when the checkout is reached through a junction", async () => {
    const outer = mkdtempSync(join(tmpdir(), "import-guard-link-"))
    const link = join(outer, "checkout")
    try {
      symlinkSync(process.cwd(), link, "junction")
      const linked = new ESLint({ cwd: link })
      const [result] = await linked.lintText(source(OLD_IMPORTS[0]), { filePath: join(link, "app/staff/reopenings/page.tsx") })
      expect(result.messages.filter((m) => m.ruleId === "no-restricted-imports")).toHaveLength(1)
    } finally {
      // Remove the link itself, never what it points to. The temp folder
      // goes only once the link is gone.
      let linkGone = !lstatSafe(link)
      if (!linkGone) {
        try {
          unlinkSync(link)
        } catch {
          rmdirSync(link)
        }
        linkGone = !lstatSafe(link)
      }
      if (linkGone) rmdirSync(outer)
    }
  })

  it("allows the kit, the icons and the shared staff modules in a converted route", async () => {
    const ok = [
      `import { Card } from "@/components/kit"`,
      `import { Icon } from "@/components/icons"`,
      `import { requireStaff } from "../session"`,
      `import { NewShell } from "../_new-shell/new-shell"`,
    ]
    for (const line of ok) expect(await restricted("app/staff/reopenings/page.tsx", source(line))).toEqual([])
  })
}, 60_000)
