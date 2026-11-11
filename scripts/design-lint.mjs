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
// components/icons/. Scripts are read with the TypeScript parser, so
// comments, regex literals and JSX text are never taken for strings.
//
// Run: node scripts/design-lint.mjs, after `npm ci` (it needs typescript).
// CI runs it and its tests in the lint job.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"

export const TOKEN_STYLESHEET = "app/tokens.css"
export const EXO_ROOTS = ["app", "components"]
export const HEX_ROOTS = ["components/kit", "components/icons"]
export const ROUTE_LOOKS = "app/staff/route-looks.ts"

const SOURCE = /\.(tsx?|css|mjs|jsx?)$/
const HEX_SOURCE = /\.(tsx?|css|mjs|jsx?|svg)$/
const SCRIPT = /\.(tsx?|mjs|jsx?)$/

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

const SCRIPT_KINDS = { ".tsx": ts.ScriptKind.TSX, ".ts": ts.ScriptKind.TS, ".jsx": ts.ScriptKind.JSX }

/**
 * Parses a TS/TSX/JS source with the TypeScript parser, so comments, regex
 * literals, JSX text and nested templates are read the way the compiler
 * reads them. The parser recovers from a syntax error, and a recovered tree
 * can leave code out, so lint() reports syntax errors as problems.
 */
export function parse(text, file = "x.tsx") {
  const kind = SCRIPT_KINDS[file.slice(file.lastIndexOf("."))] ?? ts.ScriptKind.JS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

const lineAt = (source, pos) => source.getLineAndCharacterOfPosition(pos).line + 1

/**
 * The first syntax error of a TS/TSX/JS source, as [{ line, message }], or
 * []. One error often brings others after it, so only the first is told.
 */
export function syntaxErrors(text, file = "x.tsx") {
  const source = parse(text, file)
  return (source.parseDiagnostics ?? []).slice(0, 1).map((d) => ({
    line: lineAt(source, d.start ?? 0),
    message: `cannot parse: ${ts.flattenDiagnosticMessageText(d.messageText, " ")} (design-lint reads the syntax tree)`,
  }))
}

function visit(node, each) {
  each(node)
  ts.forEachChild(node, (child) => visit(child, each))
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

const isClassString = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)

/** The words of a string or template literal, its ${…} parts left out. */
function staticTokens(node) {
  if (!ts.isTemplateExpression(node)) return words(node.text)
  // A placeholder, not a space, where each ${…} stood, so `font-exo${x}` is
  // not read as font-exo.
  return words([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("\u0000"))
}

// The ${…} of a template that stand as classes of their own: space or the
// template's start before, space or its end after. `md:${"italic"}` and
// `${"italic"}x` make other classes, so they lend nothing.
function standaloneSpans(template) {
  const spans = template.templateSpans
  return spans.filter((span, i) => {
    const before = i === 0 ? template.head.text : spans[i - 1].literal.text
    const after = span.literal.text
    const last = i === spans.length - 1
    return (before === "" ? i === 0 : /\s$/.test(before)) && (after === "" ? last : /^\s/.test(after))
  })
}

// A string that lends its italic: a bare italic, no font of its own and no
// not-italic.
const lendsItalic = (tokens) => hasItalic(tokens) && !hasUpright(tokens) && !tokens.some(isExoClass)

// Calls whose arguments make one class list, and cva-made functions such as
// buttonVariants.
const CLASS_CALL = /^(?:cn|clsx|cva|twMerge|\w+Variants)$/
function isClassCall(node) {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ""
  return CLASS_CALL.test(name)
}

const isClassNameExpression = (node) => ts.isJsxExpression(node) && ts.isJsxAttribute(node.parent) && node.parent.name.getText() === "className"

// A class expression: a className={…}, a class call or a template literal.
// The strings of the outermost one around a string are read together.
const isGroup = (node) => isClassNameExpression(node) || isClassCall(node) || ts.isTemplateExpression(node)

function outermostGroup(node) {
  let group
  for (let n = node.parent; n; n = n.parent) if (isGroup(n)) group = n
  return group
}

/**
 * Whether expr yields a lending italic string every time it is evaluated:
 * "italic", c ? "italic" : "italic", cn("italic"), ["italic"]. A string
 * behind && or ||, in one branch of ?: only, inside an object such as clsx's
 * { italic: c }, or passed to any other function may not be applied, so it
 * lends nothing.
 */
function alwaysItalic(expr) {
  // ("italic"), "italic" as const, "italic" satisfies string, "italic"!
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
    return alwaysItalic(expr.expression)
  }
  if (isClassString(expr)) {
    if (lendsItalic(staticTokens(expr))) return true
    return ts.isTemplateExpression(expr) && standaloneSpans(expr).some((span) => alwaysItalic(span.expression))
  }
  if (ts.isConditionalExpression(expr)) return alwaysItalic(expr.whenTrue) && alwaysItalic(expr.whenFalse)
  if (isClassCall(expr)) return expr.arguments.some(alwaysItalic)
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.some(alwaysItalic)
  return false
}

// The parts of `node` applied whenever its part `child` is: the other
// arguments of a class call, the other elements of an array, the other
// ${…} of a template.
function companions(node, child) {
  if (isClassCall(node)) return node.arguments.filter((a) => a !== child)
  if (ts.isArrayLiteralExpression(node)) return node.elements.filter((e) => e !== child)
  if (ts.isTemplateExpression(node)) return standaloneSpans(node).filter((s) => s !== child).map((s) => s.expression)
  return []
}

/**
 * Whether an Exo string gets its italic from what is applied with it every
 * time it is applied: its own ${…}, and, going out to its class expression,
 * the companions at each level and the text of any template it sits in.
 */
function italicLent(exo) {
  if (ts.isTemplateExpression(exo) && standaloneSpans(exo).some((span) => alwaysItalic(span.expression))) return true
  const group = outermostGroup(exo)
  if (!group) return false
  for (let child = exo, node = exo.parent; child !== group; child = node, node = node.parent) {
    if (companions(node, child).some(alwaysItalic)) return true
    if (ts.isTemplateExpression(node) && lendsItalic(staticTokens(node))) return true
  }
  return false
}

// The child of `node` on the way down to `inner`.
function childOn(node, inner) {
  let child = inner
  while (child.parent !== node) child = child.parent
  return child
}

// Two parts in different branches of one ?: are never applied together.
function exclusive(a, b) {
  const above = new Set()
  for (let n = a; n; n = n.parent) above.add(n)
  let common = b
  while (!above.has(common)) common = common.parent
  if (!ts.isConditionalExpression(common) || common === a || common === b) return false
  const branches = [common.whenTrue, common.whenFalse]
  const [ca, cb] = [childOn(common, a), childOn(common, b)]
  return ca !== cb && branches.includes(ca) && branches.includes(cb)
}

// Whether a not-italic in the same class expression may be applied with the
// Exo string.
function uprightBeside(exo) {
  let found = false
  visit(outermostGroup(exo) ?? exo, (node) => {
    if (found || node === exo || !isClassString(node)) return
    if (hasUpright(staticTokens(node)) && !exclusive(exo, node)) found = true
  })
  return found
}

/**
 * Finds upright Exo in a TSX/TS/JS source: a string or template literal
 * holding an Exo class without a bare `italic`, or with any `not-italic`. In
 * one class expression the italic may come from another string that sets no
 * font and is applied every time the Exo string is, as in cn("font-exo",
 * "italic"). One that may not be, as in cn("font-exo", c && "italic"), lends
 * nothing, and each branch of a ?: is checked on its own. A not-italic that
 * may be applied with the Exo string makes it upright.
 */
export function uprightExoInScript(text, file = "x.tsx") {
  const source = parse(text, file)
  const problems = []
  visit(source, (node) => {
    if (!isClassString(node)) return
    const tokens = staticTokens(node)
    if (!tokens.some(isExoClass)) return
    if (hasItalic(tokens) && !hasUpright(tokens)) return
    if (!hasUpright(tokens) && italicLent(node) && !uprightBeside(node)) return
    problems.push({ line: lineAt(source, node.getStart(source)), message: EXO_MESSAGE })
  })
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

// The parts of a script a colour can be written in: string and template
// text, JSX text and regex literals. Comments and names (a #private field)
// are not among them.
const TEXT_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.RegularExpressionLiteral,
])

// The source with everything a colour cannot be written in blanked to
// spaces, line breaks and positions kept.
function colourText(text, file) {
  if (file.endsWith(".css")) return cssWithoutComments(text)
  if (file.endsWith(".svg")) return text.replace(/<!--[\s\S]*?-->/g, blank)
  const source = parse(text, file)
  const kept = blank(text).split("")
  visit(source, (node) => {
    if (!TEXT_KINDS.has(node.kind)) return
    // JSX text has no leading trivia: all of it is text, even where it reads
    // like a comment, as in <p>// x</p>.
    const start = node.kind === ts.SyntaxKind.JsxText ? node.pos : node.getStart(source)
    for (let i = start; i < node.end; i++) kept[i] = text[i]
  })
  return kept.join("")
}

/**
 * Finds hex colours (#abc, #abcd, #aabbcc, #aabbccdd) in strings, templates,
 * JSX text and stylesheet or SVG text, never in comments. A fragment
 * reference (href="#a1b", url(#abc), id="#abc") is not a colour.
 */
export function hexColours(text, file = "x.tsx") {
  const problems = []
  const kept = colourText(text, file)
  for (const match of kept.matchAll(/(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g)) {
    const before = text.slice(Math.max(0, match.index - 16), match.index)
    if (/(?:href|id)\s*=\s*\{?\s*["'`]$|url\(\s*["']?$/i.test(before)) continue
    problems.push({ line: lineOf(text, match.index), message: `hex colour ${match[0]}: use a token from ${TOKEN_STYLESHEET}` })
  }
  return problems
}

/** Finds the name CountPill: an import, a JSX tag or any other reference. */
export function countPills(text, file = "x.tsx") {
  const source = parse(text, file)
  const problems = []
  visit(source, (node) => {
    if (ts.isIdentifier(node) && node.text === "CountPill") {
      problems.push({ line: lineAt(source, node.getStart(source)), message: "CountPill in a converted route: the bell is the only count (#316)" })
    }
  })
  return problems
}

function keyText(name) {
  if (ts.isStringLiteralLike(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text
  return undefined
}

/**
 * Reads route-looks.ts: every "/staff…" key of an object must map straight
 * to "new" or "legacy", comments aside. Anything else, a syntax error
 * included, is reported instead of being skipped, so the lint never quietly
 * stops covering a converted route.
 */
export function readRouteLooks(text) {
  const source = parse(text, ROUTE_LOOKS)
  const routes = []
  const errors = syntaxErrors(text, ROUTE_LOOKS)
  visit(source, (node) => {
    if (!ts.isPropertyAssignment(node)) return
    const pattern = keyText(node.name)
    if (!pattern?.startsWith("/staff")) return
    const value = node.initializer
    const look = ts.isStringLiteralLike(value) && /^(new|legacy)$/.test(value.text) ? value.text : undefined
    if (look) routes.push({ pattern, look })
    else errors.push({ line: lineAt(source, node.name.getStart(source)), message: `"${pattern}" must map to "new" or "legacy", not ${value.getText(source)}` })
  })
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
  // Each script's syntax errors, once. readRouteLooks reports its own.
  const parsed = new Set([ROUTE_LOOKS])
  const checkSyntax = (file) => {
    if (parsed.has(file) || !SCRIPT.test(file)) return
    parsed.add(file)
    add(file, syntaxErrors(read(file), file))
  }

  for (const file of EXO_ROOTS.flatMap((dir) => walk(root, dir)).filter((f) => SOURCE.test(f))) {
    checkSyntax(file)
    const found = file.endsWith(".css") ? uprightExoInCss(read(file)) : uprightExoInScript(read(file), file)
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
    checkSyntax(file)
    add(file, hexColours(read(file), file))
    if (converted.has(file) && SCRIPT.test(file)) add(file, countPills(read(file), file))
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
