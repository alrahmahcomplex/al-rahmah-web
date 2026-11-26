import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { AUDIT_ACTION_FIELDS, AUDIT_TABLE_FIELDS } from "@/app/staff/_audit-words"

// Fails when an audited column (any column of a table with the
// audit_row_change trigger) has neither words nor a "left out" entry,
// reading the schema straight from supabase/migrations/*.sql on this branch
// rather than from a local database (#504).

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations")

function stripComments(sql: string): string {
  let out = ""
  let i = 0
  while (i < sql.length) {
    if (sql[i] === "'") {
      out += sql[i++]
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "''"
          i += 2
          continue
        }
        if (sql[i] === "'") {
          out += sql[i++]
          break
        }
        out += sql[i++]
      }
    } else if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++
    } else if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++
      i += 2
    } else {
      out += sql[i++]
    }
  }
  return out
}

function splitTopLevel(str: string): string[] {
  const parts: string[] = []
  let cur = ""
  let depth = 0
  let inStr = false
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (inStr) {
      cur += c
      if (c === "'" && str[i + 1] === "'") {
        cur += str[++i]
        continue
      }
      if (c === "'") inStr = false
    } else if (c === "'") {
      inStr = true
      cur += c
    } else if (c === "(") {
      depth++
      cur += c
    } else if (c === ")") {
      depth--
      cur += c
    } else if (c === "," && depth === 0) {
      parts.push(cur.trim())
      cur = ""
    } else {
      cur += c
    }
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

// Strips function bodies (`as $tag$ ... $tag$`) while keeping `do $tag$ ... $tag$`
// migration blocks so tables and triggers created inside DO blocks are read.
function stripFunctionBodies(sql: string): string {
  return sql.replace(/\bas\s+(\$[a-zA-Z0-9_]*\$)[\s\S]*?\1/gi, "as $$ $$")
}

const CONSTRAINTS = /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude)\b/i

function parseAuditedSchemaFromMigrations(): {
  auditedTables: Map<string, Set<string>>
  actionKinds: Set<string>
} {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
  const tables = new Map<string, Set<string>>()
  const audited = new Set<string>()
  const actionKinds = new Set<string>()

  for (const file of files) {
    const raw = stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    const sql = stripFunctionBodies(raw)

    const ctRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\."?([a-z_][a-z0-9_]*)"?\s*\(/gi
    let m: RegExpExecArray | null
    while ((m = ctRe.exec(sql))) {
      const tname = m[1].toLowerCase()
      let depth = 1
      let i = m.index + m[0].length
      let inStr = false
      while (i < sql.length && depth > 0) {
        const c = sql[i++]
        if (inStr) {
          if (c === "'" && sql[i] === "'") i++
          else if (c === "'") inStr = false
        } else if (c === "'") inStr = true
        else if (c === "(") depth++
        else if (c === ")") depth--
      }
      const body = sql.slice(m.index + m[0].length, i - 1)
      const cols = tables.get(tname) ?? new Set<string>()
      for (const part of splitTopLevel(body)) {
        if (!part || CONSTRAINTS.test(part)) continue
        const cm = /^"?([a-z_][a-z0-9_]*)"?\s+/i.exec(part)
        if (cm) cols.add(cm[1].toLowerCase())
      }
      tables.set(tname, cols)
    }

    const atRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\."?([a-z_][a-z0-9_]*)"?\s+([^;]+);/gi
    while ((m = atRe.exec(sql))) {
      const tname = m[1].toLowerCase()
      const cols = tables.get(tname)
      if (!cols) continue
      for (const action of splitTopLevel(m[2])) {
        const add = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(?!constraint\b|primary\b|unique\b|check\b|foreign\b)"?([a-z_][a-z0-9_]*)"?\s+/i.exec(
          action,
        )
        if (add) {
          cols.add(add[1].toLowerCase())
          continue
        }
        const drop = /^drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/i.exec(action)
        if (drop) {
          cols.delete(drop[1].toLowerCase())
          continue
        }
        const rename = /^rename\s+(?:column\s+)?"?([a-z_][a-z0-9_]*)"?\s+to\s+"?([a-z_][a-z0-9_]*)"?/i.exec(action)
        if (rename) {
          cols.delete(rename[1].toLowerCase())
          cols.add(rename[2].toLowerCase())
        }
      }
    }

    const trRe = /create\s+trigger\s+audit_row_change[\s\S]*?\bon\s+public\."?([a-z_][a-z0-9_]*)"?/gi
    while ((m = trRe.exec(sql))) audited.add(m[1].toLowerCase())

    const dtrRe = /drop\s+trigger\s+(?:if\s+exists\s+)?audit_row_change\s+on\s+public\."?([a-z_][a-z0-9_]*)"?/gi
    while ((m = dtrRe.exec(sql))) audited.delete(m[1].toLowerCase())

    // Action kinds registered in audit_action_kinds or written directly to audit_log without a table_name.
    const kindRe = /insert\s+into\s+public\.audit_action_kinds\s*\([^)]*\)\s*values\s*([^;]+);/gi
    while ((m = kindRe.exec(raw))) {
      for (const tuple of m[1].matchAll(/\(\s*'([a-z0-9_]+)'\s*,/g)) actionKinds.add(tuple[1])
    }
    const directRe = /insert\s+into\s+public\.audit_log\s*\(([^)]+)\)\s*values\s*\(([^;]+)\)/gi
    while ((m = directRe.exec(raw))) {
      const cols = splitTopLevel(m[1]).map((c) => c.trim().toLowerCase())
      const vals = splitTopLevel(m[2])
      if (cols.includes("table_name")) continue
      const idx = cols.indexOf("action")
      if (idx === -1) continue
      const lit = /^'([a-z0-9_]+)'$/.exec(vals[idx]?.trim() ?? "")
      if (lit) actionKinds.add(lit[1])
    }
  }

  const auditedTables = new Map<string, Set<string>>()
  for (const table of [...audited].sort()) auditedTables.set(table, tables.get(table) ?? new Set())
  return { auditedTables, actionKinds }
}

describe("audit words migration coverage", () => {
  const { auditedTables, actionKinds } = parseAuditedSchemaFromMigrations()

  it("covers every table with the audit_row_change trigger and every column of each table", () => {
    expect(auditedTables.size).toBeGreaterThanOrEqual(41)

    const missingTables: string[] = []
    const missingColumns: string[] = []
    const emptyLabels: string[] = []

    for (const [table, cols] of auditedTables) {
      const specs = AUDIT_TABLE_FIELDS[table]
      if (!specs) {
        missingTables.push(table)
        continue
      }
      for (const col of cols) {
        const spec = specs[col]
        if (!spec) {
          missingColumns.push(`${table}.${col}`)
        } else if (spec.kind === "word" && spec.label.trim() === "") {
          emptyLabels.push(`${table}.${col}`)
        }
      }
    }

    expect(missingTables).toEqual([])
    expect(missingColumns).toEqual([])
    expect(emptyLabels).toEqual([])
  })

  it("lists no extra tables or dropped columns in AUDIT_TABLE_FIELDS", () => {
    const extraTables = Object.keys(AUDIT_TABLE_FIELDS).filter((t) => !auditedTables.has(t))
    const extraColumns: string[] = []
    for (const [table, specs] of Object.entries(AUDIT_TABLE_FIELDS)) {
      const cols = auditedTables.get(table)
      if (!cols) continue
      for (const col of Object.keys(specs)) {
        if (!cols.has(col)) extraColumns.push(`${table}.${col}`)
      }
    }
    expect(extraTables).toEqual([])
    expect(extraColumns).toEqual([])
  })

  it("covers every action kind written to audit_log in migrations", () => {
    const missingActions = [...actionKinds].filter((kind) => !(kind in AUDIT_ACTION_FIELDS)).sort()
    expect(missingActions).toEqual([])
  })
})
