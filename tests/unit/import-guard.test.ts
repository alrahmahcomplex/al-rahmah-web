// @vitest-environment node
import { lstatSync, mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"

// The ESLint guard of the staff side (#322, #332, eslint.config.mjs): no
// file under app/staff/ may import the old parts, however the import is
// spelled. The public pages may.

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
  it.each(OLD_IMPORTS)("refuses %s in a staff route and in the shell", async (line) => {
    expect(await restricted("app/staff/reopenings/page.tsx", source(line))).toHaveLength(1)
    expect(await restricted("app/staff/_new-shell/new-shell.tsx", source(line))).toHaveLength(1)
  })

  // Next.js folder names such as `[id]` and `[...rest]` are glob syntax;
  // the guard still covers the files inside them (#360).
  it.each(["app/staff/[...rest]/page.tsx", "app/staff/fees/[year]/page.tsx", "app/staff/re-applications/[id]/page.tsx", "app/staff/check-in/page.tsx"])(
    "refuses an old part in %s",
    async (filePath) => {
      expect(await restricted(filePath, source(OLD_IMPORTS[0]))).toHaveLength(1)
    },
  )

  it.each(OLD_IMPORTS)("allows %s on a public page", async (line) => {
    expect(await restricted("app/apply/page.tsx", source(line))).toEqual([])
  })

  // Node loads eslint.config.mjs by its real path; ESLint names the files
  // through the folder it was started in. Through a junction (a symlink off
  // Windows) the two differ, and the guard must still apply.
  it("refuses an old part in a staff route when the checkout is reached through a junction", async () => {
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

  it.each(OLD_IMPORTS)("refuses %s on Home and in the files every staff route shares", async (line) => {
    for (const file of ["app/staff/page.tsx", "app/staff/loading.tsx", "app/staff/_home/stat-card.tsx", "app/staff/layout.tsx", "app/staff/error.tsx", "app/staff/navigation.ts"]) {
      expect(await restricted(file, source(line))).toHaveLength(1)
    }
  })

  it("allows the kit, the icons and the shared staff modules in a staff route", async () => {
    const ok = [
      `import { Card } from "@/components/kit"`,
      `import { Icon } from "@/components/icons"`,
      `import { requireStaff } from "../session"`,
      `import { NewShell } from "../_new-shell/new-shell"`,
    ]
    for (const line of ok) expect(await restricted("app/staff/reopenings/page.tsx", source(line))).toEqual([])
  })
}, 60_000)
