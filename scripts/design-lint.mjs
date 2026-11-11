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
// components/icons/. Comments never count.
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

const EXO_MESSAGE = "Exo without italic (DESIGN.md, The Lean Forward Rule)"

/** Lines are 1-based. */
function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

const blank = (text) => text.replace(/[^\n]/g, " ")

/**
 * Reads a TS/TSX/JS source: its string and template literals ({ start, end,
 * value } without the quotes) and its code with comments blanked to spaces,
 * line breaks kept. A quote that reaches a line break before it closes is an
 * apostrophe in JSX text, not a string; a JSX attribute value (a quote right
 * after `=`) may span lines.
 */
export function scan(text) {
  const literals = []
  let code = ""
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === "/" && next === "/") {
      const newline = text.indexOf("\n", i)
      const end = newline === -1 ? text.length : newline
      code += blank(text.slice(i, end))
      i = end
    } else if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2)
      const end = close === -1 ? text.length : close + 2
      code += blank(text.slice(i, end))
      i = end
    } else if (c === '"' || c === "'" || c === "`") {
      const attribute = c !== "`" && /=\s*$/.test(text.slice(Math.max(0, i - 8), i))
      let j = i + 1
      let closed = false
      while (j < text.length) {
        if (text[j] === "\\") j += 2
        else if (text[j] === c) {
          closed = true
          break
        } else if (text[j] === "\n" && c !== "`" && !attribute) break
        else j++
      }
      if (!closed) {
        code += c
        i++
        continue
      }
      literals.push({ start: i, end: j + 1, value: text.slice(i + 1, j) })
      code += text.slice(i, j + 1)
      i = j + 1
    } else {
      code += c
      i++
    }
  }
  return { code, literals }
}

// Class expressions whose strings are read together, so cn("font-exo",
// "italic") counts as italic: a className={…} and a call to cn, clsx, cva,
// twMerge or a cva-made function such as buttonVariants.
function classGroups(code, literals) {
  const skip = new Map(literals.map((l) => [l.start, l.end]))
  const groups = []
  for (const match of code.matchAll(/className=\{|\b(?:cn|clsx|cva|twMerge|\w+Variants)\(/g)) {
    const open = match.index + match[0].length - 1
    if (groups.some((g) => open > g.start && open < g.end)) continue
    const [o, c] = code[open] === "{" ? ["{", "}"] : ["(", ")"]
    let depth = 0
    let i = open
    for (; i < code.length; i++) {
      if (skip.has(i)) {
        i = skip.get(i) - 1
        continue
      }
      if (code[i] === o) depth++
      else if (code[i] === c && --depth === 0) break
    }
    groups.push({ start: open, end: i })
  }
  return groups
}

// A class token whose utility (after any variants such as md: or hover:)
// sets the Exo font.
function isExoClass(token) {
  const utility = token.replace(/^!/, "").split(/:(?![^[]*\])/).pop()
  return /^font-exo$/.test(utility) || /^font-\[(family-name:)?var\(--font-exo\)\]$/.test(utility)
}

const words = (value) => value.split(/\s+/).filter(Boolean)
const hasItalic = (tokens) => tokens.includes("italic")
const hasUpright = (tokens) => tokens.some((token) => /(^|:)not-italic$/.test(token))

/**
 * Finds upright Exo in a TSX/TS/JS source: a string holding an Exo class
 * without a bare `italic`, or with any `not-italic`. In one class expression
 * the italic may come from another string that sets no font, as in
 * cn("font-exo", "italic"); one branch of a ternary that sets Exo does not
 * lend its italic to the other.
 */
export function uprightExoInScript(text) {
  const problems = []
  const { code, literals } = scan(text)
  const groups = classGroups(code, literals)
  const groupOf = (l) => groups.find((g) => l.start > g.start && l.end <= g.end)
  for (const literal of literals) {
    const tokens = words(literal.value)
    if (!tokens.some(isExoClass)) continue
    if (hasItalic(tokens) && !hasUpright(tokens)) continue
    const group = groupOf(literal)
    const siblings = group ? literals.filter((l) => l !== literal && groupOf(l) === group).map((l) => words(l.value)) : []
    const lent = siblings.some((t) => hasItalic(t) && !t.some(isExoClass))
    if (lent && !hasUpright(tokens) && !siblings.some(hasUpright)) continue
    problems.push({ line: lineOf(text, literal.start), message: EXO_MESSAGE })
  }
  return problems
}

const cssWithoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, blank)

/**
 * Finds upright Exo in a stylesheet: a rule whose font-family, font shorthand
 * or @apply names Exo without italic, or that sets font-style: normal.
 */
export function uprightExoInCss(text) {
  const problems = []
  const clean = cssWithoutComments(text)
  for (const match of clean.matchAll(/\{([^{}]*)\}/g)) {
    const declarations = match[1].split(";").map((part) => part.trim())
    const exoFont = declarations.some((d) => /^font(-family)?\s*:/i.test(d) && /exo/i.test(d.split(":").slice(1).join(":")))
    const applyTokens = declarations.filter((d) => d.startsWith("@apply")).flatMap((d) => d.slice(6).trim().split(/\s+/))
    if (!exoFont && !applyTokens.some(isExoClass)) continue
    const italic =
      declarations.some((d) => /^font-style\s*:\s*(italic|oblique)/i.test(d)) ||
      declarations.some((d) => /^font\s*:/i.test(d) && /\bitalic\b/i.test(d)) ||
      applyTokens.includes("italic")
    const upright = declarations.some((d) => /^font-style\s*:\s*normal/i.test(d)) || hasUpright(applyTokens)
    if (!italic || upright) problems.push({ line: lineOf(clean, match.index), message: EXO_MESSAGE })
  }
  return problems
}

// The source with comments blanked, by the file's own comment syntax.
function withoutComments(text, file) {
  if (file.endsWith(".css")) return cssWithoutComments(text)
  if (file.endsWith(".svg")) return text.replace(/<!--[\s\S]*?-->/g, blank)
  return scan(text).code
}

/**
 * Finds hex colours (#abc, #abcd, #aabbcc, #aabbccdd) outside comments. A
 * fragment reference (href="#a1b", url(#abc), id="#abc") is not a colour.
 */
export function hexColours(text, file = "x.tsx") {
  const problems = []
  const code = withoutComments(text, file)
  for (const match of code.matchAll(/(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g)) {
    const before = code.slice(Math.max(0, match.index - 16), match.index)
    if (/(?:href|id)\s*=\s*\{?\s*["'`]$|url\(\s*["']?$/i.test(before)) continue
    problems.push({ line: lineOf(text, match.index), message: `hex colour ${match[0]}: use a token from ${TOKEN_STYLESHEET}` })
  }
  return problems
}

/** Finds CountPill outside comments. */
export function countPills(text) {
  const problems = []
  for (const match of scan(text).code.matchAll(/\bCountPill\b/g)) {
    problems.push({ line: lineOf(text, match.index), message: "CountPill in a converted route: the bell is the only count (#316)" })
  }
  return problems
}

/**
 * Reads route-looks.ts: every "/staff…" key must map straight to "new" or
 * "legacy", comments aside. Anything else is reported instead of being
 * skipped, so the lint never quietly stops covering a converted route.
 */
export function readRouteLooks(source) {
  const code = scan(source).code
  const routes = []
  const errors = []
  for (const match of code.matchAll(/["'`](\/staff[^"'`]*)["'`]\s*:\s*([^,}\n]*)/g)) {
    const look = match[2].trim().match(/^["'`](new|legacy)["'`]$/)?.[1]
    if (look) routes.push({ pattern: match[1], look })
    else errors.push({ line: lineOf(source, match.index), message: `"${match[1]}" must map to "new" or "legacy", not ${match[2].trim() || "nothing"}` })
  }
  if (!routes.length && !errors.length) errors.push({ line: 1, message: 'no "/staff…": "new" | "legacy" entries found, so design-lint cannot tell which routes are converted' })
  return { routes, errors }
}

/** The route patterns route-looks.ts marks "new", such as "/staff/reopenings". */
export function newRoutes(source) {
  return readRouteLooks(source)
    .routes.filter((r) => r.look === "new")
    .map((r) => r.pattern)
}

function walk(root, dir, { into = () => true } = {}) {
  const out = []
  const full = join(root, dir)
  if (!existsSync(full)) return out
  for (const name of readdirSync(full).sort()) {
    const path = join(dir, name)
    if (statSync(join(root, path)).isDirectory()) {
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
    const allowance = UPRIGHT_EXO_ALLOWED[file]
    const allowed = allowance?.count ?? 0
    if (found.length > allowed) {
      add(file, allowed ? [{ line: found[0].line, message: `${found.length} upright Exo, at most ${allowed} allowed (${allowance.reason}); make the new one italic` }] : found)
    } else if (found.length < allowed) {
      // Keeps the allowance shrinking as pages are fixed.
      add(file, [{ line: 1, message: `${found.length} upright Exo, fewer than the ${allowed} allowed: lower UPRIGHT_EXO_ALLOWED in scripts/design-lint.mjs` }])
    }
  }

  const scoped = new Set(HEX_ROOTS.flatMap((dir) => walk(root, dir)))
  const converted = new Set()
  if (existsSync(join(root, ROUTE_LOOKS))) {
    const looks = readRouteLooks(read(ROUTE_LOOKS))
    add(ROUTE_LOOKS, looks.errors)
    for (const { pattern } of looks.routes.filter((r) => r.look === "new")) {
      const { missing, files } = routeFiles(root, pattern)
      if (missing) add(ROUTE_LOOKS, [{ line: 1, message: `"${pattern}" is marked new but ${missing} does not exist` }])
      for (const file of files) {
        scoped.add(file)
        converted.add(file)
      }
    }
  }
  for (const file of [...scoped].sort()) {
    if (file === TOKEN_STYLESHEET || !HEX_SOURCE.test(file)) continue
    add(file, hexColours(read(file), file))
    if (converted.has(file) && SOURCE.test(file) && !file.endsWith(".css")) add(file, countPills(read(file)))
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
