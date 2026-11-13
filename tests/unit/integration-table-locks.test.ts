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

// Each pattern runs over the whole file with its comment lines blanked, so a
// statement split over two lines is still found. `\s` spans line breaks.
const RULES: { what: string; pattern: RegExp; allowed?: (file: string, line: string) => boolean }[] = [
  { what: "lock table", pattern: /\block\s+(table\b|(only\s+)?(public\.|\$\{|"?[a-z_]+"?\s+in\s))/gi },
  { what: "alter table", pattern: /\balter\s+table\b/gi },
  // Truncating takes the whole table before a refusal trigger can fire, so it
  // goes through withoutLockWaits, which never queues for long. A table name
  // follows the keyword, unlike "truncate" as a privilege name in quotes.
  {
    what: "truncate",
    pattern: /\btruncate\s+(table\s+)?(only\s+)?(public\.|\$\{|"?[a-z_]+)/gi,
    allowed: (_, line) => line.includes("withoutLockWaits"),
  },
  // Pausing takes a lock every Family lock waits behind, and resuming
  // recomputes every sibling group: only the serial project may turn it.
  { what: "the Sibling kill switch", pattern: /set_sibling_grants_paused/g, allowed: (file) => file.startsWith(SERIAL) },
]

function offencesIn(file: string, text: string): string[] {
  const lines = text.split("\n")
  const code = lines.map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line))
  const joined = code.join("\n")
  const found: string[] = []
  for (const rule of RULES) {
    for (const match of joined.matchAll(rule.pattern)) {
      const lineNumber = joined.slice(0, match.index).split("\n").length
      if (!rule.allowed?.(file, code[lineNumber - 1])) found.push(`${file}:${lineNumber} ${rule.what}`)
    }
  }
  return found.sort()
}

describe("integration tests running side by side", () => {
  it("never lock, alter or queue to truncate a whole table, or turn the kill switch outside the serial project", () => {
    const files = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root)))
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((file) => file.startsWith(SERIAL))).toBe(true)
    expect(files.flatMap((file) => offencesIn(file, readFileSync(file, "utf8")))).toEqual([])
  })

  it("finds each statement, split over lines or without a schema too", () => {
    const file = "tests/integration/probe.test.ts"
    const probe = [
      `await sql.query("lock table public.leads in exclusive mode")`,
      `await sql.query("lock leads in share mode")`,
      `await sql.query("LOCK TABLE roles")`,
      "await sql.query(`lock",
      "  table public.roles`)",
      `await sql.query("alter table public.roles disable trigger x")`,
      `await sql.query("truncate public.leads")`,
      `await sql.query("truncate table leads")`,
      `await sql.query("select public.set_sibling_grants_paused(true)")`,
    ].join("\n")
    expect(offencesIn(file, probe)).toEqual(
      [
        `${file}:1 lock table`,
        `${file}:2 lock table`,
        `${file}:3 lock table`,
        `${file}:4 lock table`,
        `${file}:6 alter table`,
        `${file}:7 truncate`,
        `${file}:8 truncate`,
        `${file}:9 the Sibling kill switch`,
      ].sort(),
    )
  })

  it("leaves alone comments, quoted privilege names, lock-free truncates and the serial project", () => {
    const ok = [
      "// lock table public.leads, alter table and truncate public.leads named in a comment",
      `const PRIVILEGES = ["select", "truncate", "references"]`,
      `"select case when t.tgtype & 32 > 0 then 'truncate' end"`,
      `test("a row is never changed, deleted or truncated", () => {})`,
      `await withoutLockWaits(sql, "truncate public.whatsapp_group_invitations")`,
      `await sql.query("select pg_advisory_xact_lock(hashtext('lead_family'), hashtext($1))", [contact])`,
    ].join("\n")
    expect(offencesIn("tests/integration/probe.test.ts", ok)).toEqual([])
    expect(offencesIn(`${SERIAL}probe.test.ts`, `await sql.query("select public.set_sibling_grants_paused(true)")`)).toEqual([])
  })
})
