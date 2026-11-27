import "server-only"

import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { Fragment, isValidElement, type ReactNode } from "react"

import { ICONS, type IconName } from "@/components/icons/registry"

import { PART_GROUPS, PARTS, findPart, type Part } from "./catalog"

// The design system as text, read from the code itself, for llms.txt and the
// MCP server (design site, prototype v6). The files travel with those
// functions (next.config.ts, outputFileTracingIncludes), and each is read
// once per server instance.

const cache = new Map<string, Promise<string>>()

/** A file from the repository root, or null when it is not there. */
export function repoFile(path: string): Promise<string | null> {
  if (path.includes("..")) return Promise.resolve(null)
  let read = cache.get(path)
  if (!read) {
    // Not traced from here: next.config.ts lists the files these functions read
    // (outputFileTracingIncludes), so only those ship, not the whole project.
    read = readFile(join(/* turbopackIgnore: true */ process.cwd(), path), "utf8")
    cache.set(path, read)
  }
  return read.catch(() => {
    cache.delete(path)
    return null
  })
}

/** DESIGN.md's sections by heading, "## Colors" and "### Primary" alike, each with its text. */
export async function designSections(): Promise<{ heading: string; level: number; text: string }[]> {
  const doc = (await repoFile("DESIGN.md")) ?? ""
  const lines = doc.split("\n")
  const sections: { heading: string; level: number; start: number }[] = []
  lines.forEach((line, i) => {
    const match = /^(#{2,3}) (.+)$/.exec(line)
    if (match) sections.push({ heading: match[2].trim(), level: match[1].length, start: i })
  })
  return sections.map((section, i) => {
    // A ## section runs to the next ##; a ### section to the next ## or ###.
    const end = sections.slice(i + 1).find((next) => next.level <= section.level)?.start ?? lines.length
    return { heading: section.heading, level: section.level, text: lines.slice(section.start, end).join("\n").trim() }
  })
}

/** One section of DESIGN.md by its heading, matched loosely; null when none matches. */
export async function designSection(heading: string): Promise<string | null> {
  const wanted = heading.trim().toLowerCase()
  const sections = await designSections()
  const found = sections.find((s) => s.heading.toLowerCase() === wanted) ?? sections.find((s) => s.heading.toLowerCase().includes(wanted))
  return found?.text ?? null
}

const FENCE: Record<string, string> = { tsx: "tsx", ts: "ts", css: "css", md: "markdown" }

function fenced(path: string, text: string): string {
  const lang = FENCE[path.split(".").pop() ?? ""] ?? ""
  return `### ${path}\n\n\`\`\`${lang}\n${text.trimEnd()}\n\`\`\``
}

/** The list of parts, as llms.txt and list_parts give it. */
export function partsList(group?: string): string {
  const groups = group ? PART_GROUPS.filter((g) => g.toLowerCase() === group.trim().toLowerCase()) : PART_GROUPS
  if (groups.length === 0) return `No group is called "${group}". The groups: ${PART_GROUPS.join(", ")}.`
  return groups
    .map((g) => [`## ${g}`, "", ...PARTS.filter((p) => p.group === g).map((p) => `- ${p.id}: ${p.title}. ${p.summary} Code: ${p.files.join(", ")}.`)].join("\n"))
    .join("\n\n")
}

/** One part in full: what it is for, its rules from DESIGN.md, and its code. */
export async function partText(part: Part): Promise<string> {
  const rules = (await Promise.all(part.rules.map((heading) => designSection(heading)))).filter((text): text is string => Boolean(text))
  const files = await Promise.all(part.files.map(async (path) => [path, await repoFile(path)] as const))
  return [
    `# ${part.title} (${part.id})`,
    "",
    `Group: ${part.group}. ${part.summary}`,
    "",
    "Use it as it is: import it, never redraw it. A part the kit lacks is added to the kit first (DESIGN.md, The Kit First Rule).",
    "",
    "## Rules (DESIGN.md)",
    "",
    rules.length ? rules.join("\n\n") : "None beyond the general rules.",
    "",
    "## Code",
    "",
    ...files.map(([path, text]) => (text === null ? `### ${path}\n\n(not found)` : fenced(path, text))),
  ].join("\n")
}

/** A part by name, or a message naming the parts there are. */
export async function partOrHelp(name: string): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  const part = findPart(name)
  if (!part) return { ok: false, text: `No part is called "${name}". Ask list_parts for every part's name.` }
  return { ok: true, text: await partText(part) }
}

const attrName = (prop: string) => prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")

/** An icon's lines as SVG markup: the registry holds only <path>, <circle> and <rect> elements, alone or in a fragment. */
export function svgMarkup(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(svgMarkup).join("")
  if (!isValidElement(node)) return ""
  const { children, ...props } = node.props as Record<string, unknown> & { children?: ReactNode }
  if (node.type === Fragment) return svgMarkup(children)
  if (typeof node.type !== "string") return ""
  const attrs = Object.entries(props)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => ` ${attrName(key)}="${escape(String(value))}"`)
    .join("")
  return `<${node.type}${attrs}>${svgMarkup(children)}</${node.type}>`
}

/** Every icon of set 1 as SVG, or one by name: the main line, then the detail. */
export function iconsText(name?: string): string {
  const names = (Object.keys(ICONS) as IconName[]).filter((n) => !name || n === name.trim().toLowerCase())
  if (names.length === 0) return `No icon is called "${name}". The icons: ${Object.keys(ICONS).join(", ")}.`
  const svg = (n: IconName) => {
    const { outline, detail } = ICONS[n]
    const second = detail ? `<g class="gf-ic-detail">${svgMarkup(detail)}</g>` : ""
    return `<svg class="gf-ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g class="gf-ic-line">${svgMarkup(outline)}</g>${second}</svg>`
  }
  return [
    "Use the Icon component from @/components/icons with these names; never paste an icon's paths into a page. Indigo at rest; the detail (gf-ic-detail) turns orange in use.",
    "",
    ...names.map((n) => `- ${n}: ${svg(n)}`),
  ].join("\n")
}

/** The whole design system as one plain-text page (llms.txt). */
export async function llmsText(origin: string): Promise<string> {
  const [design, tokens] = await Promise.all([repoFile("DESIGN.md"), repoFile("app/tokens.css")])
  return [
    "# Al-Rahmah Complex design system",
    "",
    "> The approved design system of the Al-Rahmah Complex apps: the School Landing Page, the Admissions Portal and the Referral Tracking System. One Next.js app, Tailwind v4, the parts in components/kit, components/guided-form, components/icons and components/illustrations, the colours in app/tokens.css.",
    "",
    "How to use it:",
    "- Build every screen only from these parts. Import them; never redraw a part, an icon or the logo.",
    "- A part a screen needs that is not here is added to the kit first, then used (The Kit First Rule below).",
    "- Every page sits in the shell: the white frame, the top bar, the sidebar and the outlined stage (part: shell).",
    `- For one part's code and rules, open ${origin}/llms.txt?key=<the same password>&part=<part id>, or ask the MCP server at ${origin}/mcp (get_part).`,
    "",
    "# Parts",
    "",
    partsList(),
    "",
    "# Rules: DESIGN.md",
    "",
    design ?? "(DESIGN.md could not be read.)",
    "",
    "# Tokens: app/tokens.css",
    "",
    "```css",
    (tokens ?? "/* app/tokens.css could not be read. */").trimEnd(),
    "```",
    "",
  ].join("\n")
}
