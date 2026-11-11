#!/usr/bin/env node
// Checks the rules of DESIGN.md that a script can see in the source, so the
// staff app redesign (#316) cannot drift screen by screen:
//
// 1. Exo is always italic (The Lean Forward Rule), in app/ and components/.
// 2. No hex colour in the kit, the icons or a converted staff route: those
//    use the tokens of app/tokens.css, the one file where a hex may be written.
// 3. No CountPill in a converted staff route: the bell is the only count
//    (#316, lead's answer 2).
//
// A converted route is one app/staff/route-looks.ts marks "new". Until that
// file exists (F6, #322), rules 2 and 3 cover only components/kit/ and
// components/icons/.
//
// Run: node scripts/design-lint.mjs. CI runs it in the lint job.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const TOKEN_STYLESHEET = "app/tokens.css"
export const EXO_ROOTS = ["app", "components"]
export const HEX_ROOTS = ["components/kit", "components/icons"]
export const ROUTE_LOOKS = "app/staff/route-looks.ts"

const SOURCE = /\.(tsx?|css|mjs|jsx?)$/
const HEX_SOURCE = /\.(tsx?|css|mjs|jsx?|svg)$/

// Upright Exo already on the public pages when this check arrived. Making it
// italic changes how those pages look, which needs the owner's approval of a
// prototype first (AGENTS.md, UI and UX changes), so each file may keep at
// most this many. A new upright Exo anywhere, or one more in these files,
// fails; so does one fewer, until the count here is lowered to match.
export const UPRIGHT_EXO_ALLOWED = {
  "app/auth/confirm/confirm-form.tsx": { count: 4, reason: "Set your password page: hint, errors and the Log in link" },
  "app/discount-code/account-message.tsx": { count: 1, reason: "Discount code sign-in error" },
  "app/discount-code/link-request-form.tsx": { count: 4, reason: "Discount code link request: status, link, fallback and expired intro" },
  "app/discount-code/students/page.tsx": { count: 1, reason: "Discount code students page: a text link" },
  "app/login/login-form.tsx": { count: 2, reason: "Sign-in page: the Forgot password link and the error" },
  "app/login/other-session-notice.tsx": { count: 1, reason: "Sign-in page: the other-session notice" },
  "app/login/reset-password/reset-password-form.tsx": { count: 2, reason: "Reset password page: the password rule and the Log in link" },
  "components/auth-card.tsx": { count: 1, reason: "Sign-in card intro line" },
}

/** Lines are 1-based. */
function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

// A class token whose utility (after any variants such as md: or hover:)
// sets the Exo font.
function isExoClass(token) {
  const utility = token.replace(/^!/, "").split(/:(?![^[]*\])/).pop()
  return /^font-exo$/.test(utility) || /^font-\[(family-name:)?var\(--font-exo\)\]$/.test(utility)
}

/**
 * Finds upright Exo in a TSX/TS/JS source: a string literal holding an Exo
 * class without a bare `italic` class, or with any `not-italic`.
 */
export function uprightExoInScript(text) {
  const problems = []
  const literal = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g
  for (const match of text.matchAll(literal)) {
    const tokens = match[0].slice(1, -1).split(/\s+/).filter(Boolean)
    if (!tokens.some(isExoClass)) continue
    const italic = tokens.includes("italic") && !tokens.some((token) => /(^|:)not-italic$/.test(token))
    if (!italic) problems.push({ line: lineOf(text, match.index), message: "Exo without italic (DESIGN.md, The Lean Forward Rule)" })
  }
  return problems
}

/**
 * Finds upright Exo in a stylesheet: a rule whose font-family, font shorthand
 * or @apply names Exo without italic, or that sets font-style: normal.
 */
export function uprightExoInCss(text) {
  const problems = []
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
  for (const match of clean.matchAll(/\{([^{}]*)\}/g)) {
    const body = match[1]
    const declarations = body.split(";").map((part) => part.trim())
    const exoFont = declarations.some((d) => /^font(-family)?\s*:/i.test(d) && /exo/i.test(d.split(":").slice(1).join(":")))
    const applyTokens = declarations.filter((d) => d.startsWith("@apply")).flatMap((d) => d.slice(6).trim().split(/\s+/))
    const exoApply = applyTokens.some(isExoClass)
    if (!exoFont && !exoApply) continue
    const italic =
      declarations.some((d) => /^font-style\s*:\s*(italic|oblique)/i.test(d)) ||
      declarations.some((d) => /^font\s*:/i.test(d) && /\bitalic\b/i.test(d)) ||
      applyTokens.includes("italic")
    const upright = declarations.some((d) => /^font-style\s*:\s*normal/i.test(d)) || applyTokens.some((t) => /(^|:)not-italic$/.test(t))
    if (!italic || upright) problems.push({ line: lineOf(clean, match.index), message: "Exo without italic (DESIGN.md, The Lean Forward Rule)" })
  }
  return problems
}

/** Finds hex colours (#abc, #abcd, #aabbcc, #aabbccdd). */
export function hexColours(text) {
  const problems = []
  for (const match of text.matchAll(/(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g)) {
    problems.push({ line: lineOf(text, match.index), message: `hex colour ${match[0]}: use a token from ${TOKEN_STYLESHEET}` })
  }
  return problems
}

/** Finds CountPill. */
export function countPills(text) {
  const problems = []
  for (const match of text.matchAll(/\bCountPill\b/g)) {
    problems.push({ line: lineOf(text, match.index), message: "CountPill in a converted route: the bell is the only count (#316)" })
  }
  return problems
}

/** The route patterns route-looks.ts marks "new", such as "/staff/reopenings". */
export function newRoutes(source) {
  const routes = []
  for (const match of source.matchAll(/["'`](\/staff[^"'`]*)["'`]\s*:\s*["'`]new["'`]/g)) routes.push(match[1])
  return routes
}

function walk(root, dir, { into = () => true } = {}) {
  const out = []
  const full = join(root, dir)
  if (!existsSync(full)) return out
  for (const name of readdirSync(full).sort()) {
    const path = join(dir, name)
    const stat = statSync(join(root, path))
    if (stat.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue
      if (into(path)) out.push(...walk(root, path, { into }))
    } else out.push(path.split(sep).join("/"))
  }
  return out
}

/**
 * The files of a converted route: its own folder, and folders inside it that
 * are not routes themselves (no page.tsx). A nested route has its own entry
 * in route-looks.ts.
 */
export function routeFiles(root, pattern) {
  const dir = join("app", ...pattern.split("/").filter(Boolean))
  if (!existsSync(join(root, dir))) return { missing: dir.split(sep).join("/"), files: [] }
  return { files: walk(root, dir, { into: (path) => !existsSync(join(root, path, "page.tsx")) }) }
}

/** Every problem under root, as { file, line, message }. */
export function lint(root) {
  const problems = []
  const add = (file, found) => found.forEach((p) => problems.push({ file, ...p }))
  const read = (file) => readFileSync(join(root, file), "utf8")

  for (const file of EXO_ROOTS.flatMap((dir) => walk(root, dir)).filter((f) => SOURCE.test(f))) {
    const found = file.endsWith(".css") ? uprightExoInCss(read(file)) : uprightExoInScript(read(file))
    const allowed = UPRIGHT_EXO_ALLOWED[file]?.count ?? 0
    if (found.length > allowed) {
      add(file, allowed ? [{ line: found[0].line, message: `${found.length} upright Exo, at most ${allowed} allowed (${UPRIGHT_EXO_ALLOWED[file].reason}); make the new one italic` }] : found)
    } else if (found.length < allowed) {
      // Keeps the allowance shrinking as pages are fixed.
      add(file, [{ line: 1, message: `${found.length} upright Exo, fewer than the ${allowed} allowed: lower UPRIGHT_EXO_ALLOWED in scripts/design-lint.mjs` }])
    }
  }

  const scoped = new Set(HEX_ROOTS.flatMap((dir) => walk(root, dir)))
  const converted = new Set()
  if (existsSync(join(root, ROUTE_LOOKS))) {
    for (const pattern of newRoutes(read(ROUTE_LOOKS))) {
      const { missing, files } = routeFiles(root, pattern)
      if (missing) problems.push({ file: ROUTE_LOOKS, line: 1, message: `"${pattern}" is marked new but ${missing} does not exist` })
      files.forEach((file) => {
        scoped.add(file)
        converted.add(file)
      })
    }
  }
  for (const file of [...scoped].sort()) {
    if (file === TOKEN_STYLESHEET || !HEX_SOURCE.test(file)) continue
    add(file, hexColours(read(file)))
    if (converted.has(file) && SOURCE.test(file)) add(file, countPills(read(file)))
  }
  return problems
}

function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
  const problems = lint(root)
  for (const p of problems) console.error(`${relative(root, join(root, p.file)).split(sep).join("/")}:${p.line}  ${p.message}`)
  if (problems.length) {
    console.error(`\ndesign-lint: ${problems.length} problem${problems.length === 1 ? "" : "s"} (DESIGN.md)`)
    process.exit(1)
  }
  console.log("design-lint: no problems")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
