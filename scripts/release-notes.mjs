// An app PR's changelog entry is a file of its own in changes/, so two PRs
// never edit CHANGELOG.md at the same time. After a merge, the Release
// workflow (.github/workflows/release.yml) gathers the files into CHANGELOG.md
// and scripts/release.mjs dates, versions and tags the entry.
//
//   node scripts/release-notes.mjs check     every file in changes/ is valid, and CHANGELOG.md has no Unreleased entry
//   node scripts/release-notes.mjs collect   move every file in changes/ into a top Unreleased entry; print the bump
//
// A file in changes/ (any name ending .md except README.md):
//
//   ---
//   bump: minor
//   ---
//
//   ### NEW
//
//   - What someone using the app can now do.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export const SECTIONS = ["NEW", "IMPROVED", "FIXED"]
const BUMPS = ["patch", "minor"]

// One file's bump and sections, or its errors.
export function parseNote(name, text) {
  const errors = []
  const normalized = text.replace(/\r\n/g, "\n")
  const front = normalized.match(/^---\nbump: *(\S+) *\n---\n/)
  if (!front) return { errors: [`${name}: must start with "---", "bump: patch" or "bump: minor", "---"`] }
  const bump = front[1]
  if (!BUMPS.includes(bump)) errors.push(`${name}: bump must be patch or minor, not "${bump}". A major release is prepared by hand.`)
  const body = normalized.slice(front[0].length).trim()
  const sections = {}
  const parts = body.split(/^### +/m)
  if (parts[0].trim()) errors.push(`${name}: text before the first "### NEW", "### IMPROVED" or "### FIXED"`)
  for (const part of parts.slice(1)) {
    const [title, ...rest] = part.split("\n")
    const content = rest.join("\n").trim()
    if (!SECTIONS.includes(title.trim())) errors.push(`${name}: "### ${title.trim()}" is not one of ${SECTIONS.join(", ")}`)
    else if (sections[title.trim()]) errors.push(`${name}: "### ${title.trim()}" appears twice`)
    else if (!/^- \S/.test(content)) errors.push(`${name}: "### ${title.trim()}" needs at least one "- " bullet`)
    else if (/^#{1,6} /m.test(content)) errors.push(`${name}: only "###" section headings are allowed`)
    else sections[title.trim()] = content
  }
  if (!Object.keys(sections).length && !errors.length) errors.push(`${name}: needs a "### NEW", "### IMPROVED" or "### FIXED" section`)
  return errors.length ? { errors } : { bump, sections, errors: [] }
}

// The Unreleased entry for several notes, oldest first, and the larger bump.
export function combine(notes) {
  const lines = ["## Unreleased", ""]
  for (const section of SECTIONS) {
    const bodies = notes.map((note) => note.sections[section]).filter(Boolean)
    if (bodies.length) lines.push(`### ${section}`, "", bodies.join("\n"), "")
  }
  const bump = notes.some((note) => note.bump === "minor") ? "minor" : "patch"
  return { entry: `${lines.join("\n")}\n`, bump }
}

export function insertEntry(changelog, entry) {
  const first = changelog.search(/^## /m)
  if (first === -1) return `${changelog.trimEnd()}\n\n${entry}`
  return changelog.slice(0, first) + entry + changelog.slice(first)
}

export function noteFiles(root) {
  const dir = join(root, "changes")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md").sort()
}

function addedAt(root, name) {
  try {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "-1", "--", `changes/${name}`], { cwd: root, encoding: "utf8" }).trim()
    return Number(out) || Number.MAX_SAFE_INTEGER
  } catch { return Number.MAX_SAFE_INTEGER }
}

function main() {
  const [command] = process.argv.slice(2)
  const root = process.cwd()
  const names = noteFiles(root)
  const parsed = names.map((name) => ({ name, ...parseNote(name, readFileSync(join(root, "changes", name), "utf8")) }))
  const errors = parsed.flatMap((note) => note.errors)
  const changelogPath = join(root, "CHANGELOG.md")
  const changelog = readFileSync(changelogPath, "utf8")
  if (/^## Unreleased\s*$/m.test(changelog)) errors.push("CHANGELOG.md has an Unreleased entry. Put it in a file in changes/ instead (see changes/README.md).")
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; return }
  if (command === "check") {
    console.log(`${names.length} changelog ${names.length === 1 ? "file" : "files"} in changes/ ${names.length === 1 ? "is" : "are"} valid.`)
  } else if (command === "collect") {
    if (!parsed.length) return
    const ordered = parsed.map((note) => ({ ...note, at: addedAt(root, note.name) })).sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    const { entry, bump } = combine(ordered)
    writeFileSync(changelogPath, insertEntry(changelog, entry))
    for (const note of ordered) rmSync(join(root, "changes", note.name))
    console.log(bump)
  } else {
    throw new Error("Usage: release-notes.mjs check | collect")
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
