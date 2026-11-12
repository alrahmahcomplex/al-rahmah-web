// @vitest-environment node
import { readFileSync } from "node:fs"

import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"

import { config } from "../../eslint.config.mjs"

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
