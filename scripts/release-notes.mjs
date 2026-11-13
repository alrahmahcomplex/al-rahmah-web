// An app PR's changelog entry is a file of its own in changes/, so two PRs
// never edit the same file. After a merge, the Release workflow
// (.github/workflows/release.yml) tags the merge commit with the next version
// and publishes the files added since the last release as a GitHub Release.
// Nothing is committed to main: the tag goes on the merge, which CI tested and
// Vercel deployed.
//
//   node scripts/release-notes.mjs check
//       every file in changes/ is valid, and CHANGELOG.md gained no entry
//   node scripts/release-notes.mjs release --commit <sha> --notes <file> [--date YYYY-MM-DD]
//       tag <sha> locally with the next version, write the release notes to
//       <file> and print the version; print nothing if there is nothing to release
//
// A file in changes/ (a flat name ending .md; README.md is not one):
//
//   ---
//   bump: minor
//   ---
//
//   ### NEW
//
//   - What someone using the app can now do.
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export const SECTIONS = ["NEW", "IMPROVED", "FIXED"]
const BUMPS = ["patch", "minor"]
const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

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

// The release notes for several files, oldest first, and the larger bump.
export function combine(notes) {
  const lines = []
  for (const section of SECTIONS) {
    const bodies = notes.map((note) => note.sections[section]).filter(Boolean)
    if (bodies.length) lines.push(`### ${section}`, "", bodies.join("\n"), "")
  }
  const bump = notes.some((note) => note.bump === "minor") ? "minor" : "patch"
  return { body: `${lines.join("\n").trimEnd()}\n`, bump }
}

export function nextVersion(latest, bump) {
  const parts = latest.match(VERSION).slice(1).map(Number)
  if (bump === "minor") return `v${parts[0]}.${parts[1] + 1}.0`
  return `v${parts[0]}.${parts[1]}.${parts[2] + 1}`
}

const compare = (a, b) => {
  const x = a.match(VERSION).slice(1).map(Number)
  const y = b.match(VERSION).slice(1).map(Number)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

// Anything in changes/ that is not a flat .md file would pass unread and never
// be released, so check refuses it.
export function pathErrors(root) {
  const errors = []
  for (const entry of readdirSync(join(root, "changes"), { withFileTypes: true })) {
    if (entry.isDirectory()) errors.push(`changes/${entry.name}/: no folders in changes/. Name the file after the branch with "/" turned into "-": changes/feature-x.md`)
    else if (!entry.name.endsWith(".md")) errors.push(`changes/${entry.name}: a changelog file ends in .md`)
  }
  return errors
}

const isNote = (path) => /^changes\/[^/]+\.md$/.test(path) && path !== "changes/README.md"

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd()
}

function check(root) {
  const names = readdirSync(join(root, "changes")).filter((name) => isNote(`changes/${name}`)).sort()
  const errors = [
    ...pathErrors(root),
    ...names.flatMap((name) => parseNote(name, readFileSync(join(root, "changes", name), "utf8")).errors),
  ]
  if (/^## Unreleased\s*$/m.test(readFileSync(join(root, "CHANGELOG.md"), "utf8"))) {
    errors.push("CHANGELOG.md has an Unreleased entry. Put it in a file in changes/ instead (see changes/README.md).")
  }
  return { names, errors }
}

// Tags `commit` with the next version and returns { version, notes }, or null
// when no changelog file arrived since the last release. Run again on a commit
// it already tagged, it returns that release again, so a failed push or
// publish can be finished by running it again.
export function release(root, commit, date) {
  const tags = git(root, "tag", "--merged", commit).split("\n").filter((tag) => VERSION.test(tag)).sort(compare)
  const latest = tags.at(-1)
  if (!latest) throw new Error(`No vX.Y.Z tag is reachable from ${commit}.`)
  const own = git(root, "tag", "--points-at", commit).split("\n").filter((tag) => VERSION.test(tag)).sort(compare).at(-1)
  const base = own ? tags.filter((tag) => compare(tag, own) < 0).at(-1) : latest
  if (!base) throw new Error(`No release before ${own}.`)
  const added = git(root, "diff", "--name-only", "--diff-filter=A", base, commit, "--", "changes").split("\n").filter(isNote)
  if (!added.length) return null
  const notes = added
    .map((path) => {
      const parsed = parseNote(path, git(root, "show", `${commit}:${path}`))
      if (parsed.errors.length) throw new Error(parsed.errors.join("\n"))
      const at = Number(git(root, "log", "--diff-filter=A", "--format=%ct", "-1", commit, "--", path)) || 0
      return { ...parsed, path, at }
    })
    .sort((a, b) => a.at - b.at || a.path.localeCompare(b.path))
  const { body, bump } = combine(notes)
  const version = own ?? nextVersion(latest, bump)
  if (!own) {
    if (git(root, "tag", "--list", version)) throw new Error(`${version} already exists on another commit. Fetch the tags and look before releasing.`)
    const summary = body.match(/^- (.+)$/m)[1]
    git(root, "tag", "-a", version, commit, "-m", `${version}: ${summary}`)
  }
  return { version, notes: `Released ${date}.\n\n${body}` }
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  const option = (name) => { const index = rest.indexOf(`--${name}`); return index === -1 ? undefined : rest[index + 1] }
  const root = process.cwd()
  if (command === "check") {
    const { names, errors } = check(root)
    if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; return }
    console.log(`${names.length} changelog ${names.length === 1 ? "file" : "files"} in changes/ checked.`)
  } else if (command === "release" && option("commit") && option("notes")) {
    const date = option("date") ?? new Date().toISOString().slice(0, 10)
    const result = release(root, option("commit"), date)
    if (!result) return
    writeFileSync(option("notes"), result.notes)
    console.log(result.version)
  } else {
    throw new Error("Usage: release-notes.mjs check | release --commit <sha> --notes <file> [--date YYYY-MM-DD]")
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
