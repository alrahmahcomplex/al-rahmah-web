import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

// The integration test files run four at a time against one local Supabase.
// A test that locks a whole table, alters one, truncates one while other
// tests queue behind it, or turns the Sibling kill switch, can deadlock or
// time out the tests running beside it. docs/agents/workflow.md has the rule;
// this keeps those statements out of the parallel files. Comment lines are
// skipped, so a comment may still name them.

const ROOTS = ["tests/integration", "tests/support"]
const SERIAL = "tests/integration/serial/"

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (name.endsWith(".ts")) out.push(relative(process.cwd(), path).split(sep).join("/"))
  }
  return out.sort()
}

const RULES: { what: string; pattern: RegExp; allowed?: (file: string, line: string) => boolean }[] = [
  { what: "lock table", pattern: /\block\s+table\b/i },
  { what: "alter table", pattern: /\balter\s+table\b/i },
  // Truncating takes the whole table before a refusal trigger can fire, so it
  // goes through withoutLockWaits, which never queues for long.
  { what: "truncate", pattern: /\btruncate\s+(table\s+)?(only\s+)?(public\.|\$\{)/i, allowed: (_, line) => line.includes("withoutLockWaits") },
  // Pausing takes a lock every Family lock waits behind, and resuming
  // recomputes every sibling group: only the serial project may turn it.
  { what: "the Sibling kill switch", pattern: /set_sibling_grants_paused/, allowed: (file) => file.startsWith(SERIAL) },
]

function offences(): string[] {
  const found: string[] = []
  for (const file of ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root)))) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        for (const rule of RULES) {
          if (rule.pattern.test(line) && !rule.allowed?.(file, line)) found.push(`${file}:${i + 1} ${rule.what}`)
        }
      })
  }
  return found
}

describe("integration tests running side by side", () => {
  it("never lock, alter or queue to truncate a whole table, or turn the kill switch outside the serial project", () => {
    expect(offences()).toEqual([])
  })

  it("finds the files it checks", () => {
    const files = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root)))
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((file) => file.startsWith(SERIAL))).toBe(true)
  })
})
