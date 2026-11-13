// An app PR's changelog entry is a file of its own in changes/, so two PRs
// never edit the same file. After a merge, the Release workflow
// (.github/workflows/release.yml) tags the merge commit with the next version
// and publishes the files added since the last release as a GitHub Release.
// Nothing is committed to main: the tag goes on the merge, which CI tested and
// Vercel deployed.
//
//   node scripts/release-notes.mjs check [--base <commit>] [--before <commit>]
//       every file in changes/ is valid, and CHANGELOG.md gained no entry.
//       --base is for a pull request: no file that was already in changes/
//       at the merge-base of <commit> and HEAD is edited, renamed or deleted.
//       --before is for a push, <commit> being the branch before it: HEAD
//       descends from <commit>, and no file in changes/ there is edited,
//       renamed or deleted
//   node scripts/release-notes.mjs release --commit <sha> --notes <file> [--date YYYY-MM-DD]
//       tag <sha>, a commit on origin/main, locally with the next version,
//       write the release notes to <file> and print the version; print
//       nothing if there is nothing to release
//   node scripts/release-notes.mjs pending --commit <sha>
//       print the changelog files merged up to <sha> that no release holds
//       yet, and fail if there are any; it tags nothing. `release.mjs tag`
//       refuses a tag by hand while there are, or once a later merge is
//       released
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
// The only branch that is released, as the last fetch saw it.
const MAIN = "refs/remotes/origin/main"

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
    else if (!/^[a-z0-9][a-z0-9._-]*\.md$/.test(entry.name) && entry.name !== "README.md") errors.push(`changes/${entry.name}: use lower-case letters, digits, ".", "_" and "-" only`)
  }
  return errors
}

const isNote = (path) => /^changes\/[^/]+\.md$/.test(path) && path !== "changes/README.md"

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trimEnd()
}

// git's output, or null when it exits non-zero.
function spawnText(root, ...args) {
  try { return git(root, ...args) } catch { return null }
}

// A merged changelog file stays as it is. The release finds a file by the
// merge that added it, so an edited one would not be released again, and a
// deleted or replaced one would lose its entry or its bump. `from` is the
// commit that holds the merged files. NUL-separated, so no file name comes
// back quoted.
function mergedNoteErrors(root, from) {
  const fields = git(root, "diff", "--name-status", "-z", "--find-renames", from, "HEAD", "--", "changes").split("\0")
  const verbs = { M: "edits", T: "edits", D: "deletes", R: "renames" }
  const errors = []
  for (let index = 0; index + 1 < fields.length;) {
    const status = fields[index][0]
    const path = fields[index + 1]
    index += status === "R" || status === "C" ? 3 : 2
    if (verbs[status] && isNote(path)) errors.push(`${path} is already merged and this change ${verbs[status]} it. A merged changelog file stays as it is: add a new file instead (see changes/README.md).`)
  }
  return errors
}

// A pull request is compared with the merge-base of its base and HEAD, so a
// branch behind `base` is not blamed for files it never saw.
function pullRequestErrors(root, base) {
  const from = spawnText(root, "merge-base", base, "HEAD")
  if (from === null) return [`Cannot compare changes/ with "${base}": it has no merge-base with HEAD. Fetch the full history.`]
  return mergedNoteErrors(root, from)
}

// A push is compared with the branch as it was before the push. A merge-base
// would not do: a push that replaces the branch with another history (a
// force-push) has its merge-base before the files it drops, and would pass.
// Such a push is refused whatever it holds. A commit it left behind is often
// not fetched at all, and that is refused the same way.
function pushErrors(root, before) {
  if (spawnText(root, "merge-base", "--is-ancestor", before, "HEAD") === null) {
    return [`This push does not descend from "${before}", where the branch was before it: the branch was replaced (a force-push), or that commit is not fetched. Merged changelog files may be lost. Compare changes/ with that commit by hand and put back any file that is gone.`]
  }
  return mergedNoteErrors(root, before)
}

function check(root, { base, before } = {}) {
  const names = readdirSync(join(root, "changes")).filter((name) => isNote(`changes/${name}`)).sort()
  const errors = [
    ...pathErrors(root),
    ...names.flatMap((name) => parseNote(name, readFileSync(join(root, "changes", name), "utf8")).errors),
    ...(base ? pullRequestErrors(root, base) : []),
    ...(before ? pushErrors(root, before) : []),
  ]
  if (/^## Unreleased\s*$/m.test(readFileSync(join(root, "CHANGELOG.md"), "utf8"))) {
    errors.push("CHANGELOG.md has an Unreleased entry. Put it in a file in changes/ instead (see changes/README.md).")
  }
  return { names, errors }
}

// Where `commit` sits on main, and main's releases: `released` is every one,
// lowest version first, `tags` those at or before `commit`, `latest` the
// highest of them.
function releasesOfMain(root, commit) {
  const sha = git(root, "rev-parse", "--verify", `${commit}^{commit}`)
  const main = spawnText(root, "rev-list", "--first-parent", MAIN)
  if (main === null) throw new Error("origin/main is not fetched, so there is no telling whether this commit is on main.")
  // Main's own commits, newest first, and how far back each one is.
  const place = new Map(main.split("\n").map((entry, index) => [entry, index]))
  const at = place.get(sha)
  if (at === undefined) throw new Error(`${commit} is not a commit on origin/main. Only main is released.`)
  // Every version tag on one of those commits, lowest version first. An
  // annotated tag gives its commit in the third field, a lightweight one in
  // the second.
  const released = git(root, "for-each-ref", "--format=%(refname:strip=2) %(objectname) %(*objectname)", "refs/tags").split("\n")
    .map((line) => line.split(" "))
    .filter(([tag]) => VERSION.test(tag))
    .map(([tag, object, peeled]) => ({ tag, index: place.get(peeled || object) }))
    .filter(({ index }) => index !== undefined)
    .sort((a, b) => compare(a.tag, b.tag))
  const tags = released.filter(({ index }) => index >= at).map(({ tag }) => tag)
  const latest = tags.at(-1)
  if (!latest) throw new Error(`No vX.Y.Z tag on origin/main at or before ${commit}.`)
  return { sha, at, released, tags, latest }
}

// Every changelog file a merge added after `base`, up to `sha`.
// NUL-separated, so no file name comes back quoted.
function addedSince(root, base, sha) {
  return [...new Set(git(root, "log", "--first-parent", "--diff-filter=A", "--name-only", "-z", "--format=", `${base}..${sha}`, "--", "changes").split("\0").map((path) => path.trim()).filter(isNote))].sort()
}

// The changelog files merged up to `commit` that no release holds yet: those
// added since the last release at or before it. None if `commit` or a later
// merge is already released, since that release took them. It tags nothing.
// A version tagged by hand on `commit` while this lists files would become
// the next release's starting point, and the files would never be published.
export function pending(root, commit) {
  const { sha, at, released, latest } = releasesOfMain(root, commit)
  if (released.some(({ index }) => index <= at)) return []
  return addedSince(root, latest, sha)
}

// A release tagged on a later commit of main than `commit`, if there is one.
// `pending` lists nothing then, since that release took the files. A higher
// version tagged by hand on `commit` would still become the next release's
// starting point, and that release's files would be published a second time.
export function laterRelease(root, commit) {
  const { at, released } = releasesOfMain(root, commit)
  return released.find(({ index }) => index < at)?.tag
}

// Tags `commit` with the next version and returns { version, notes }, or null
// when there is nothing to release: no changelog file arrived since the last
// release, or a later merge's release already took this commit's files. `log`
// is told which. Run again on a commit it already tagged, it returns that
// release again, so a failed push or publish can be finished by running it
// again. Only a commit main itself went through is released: not a commit of
// the branch behind a merge, and not another branch. A release is likewise a
// version tag on a commit main itself went through: a tag on another branch,
// merged since or not, is neither the release before this one nor a release
// that took this commit's files.
export function release(root, commit, date, log = () => {}) {
  const { sha, at, released, tags, latest } = releasesOfMain(root, commit)
  const own = released.filter(({ index }) => index === at).at(-1)?.tag
  if (!own) {
    // A release tagged on a later merge took every file up to that merge,
    // this commit's too. Its own run, started late or again, has nothing left.
    const later = released.find(({ index }) => index < at)?.tag
    if (later) { log(`${commit} is already released in ${later}.`); return null }
  }
  const base = own ? tags.filter((tag) => compare(tag, own) < 0).at(-1) : latest
  if (!base) throw new Error(`No release before ${own}.`)
  // `check --base` keeps a merged file from being edited, renamed or deleted,
  // so each path is added once and is still there. Should one be gone all the
  // same, its last text is released.
  const added = addedSince(root, base, sha)
  if (!added.length) { log(`No changelog file arrived since ${base}.`); return null }
  const notes = added
    .map((path) => {
      // Its text at the release commit, or the last text it had before it went.
      const present = spawnText(root, "cat-file", "-e", `${sha}:${path}`) !== null
      const source = present ? sha : `${git(root, "rev-list", "-1", "--first-parent", sha, "--", path)}^`
      const parsed = parseNote(path, git(root, "show", `${source}:${path}`))
      if (parsed.errors.length) throw new Error(parsed.errors.join("\n"))
      const at = Number(git(root, "log", "--first-parent", "--diff-filter=A", "--format=%ct", "-1", sha, "--", path)) || 0
      return { ...parsed, path, at }
    })
    .sort((a, b) => a.at - b.at || a.path.localeCompare(b.path))
  const { body, bump } = combine(notes)
  const version = own ?? nextVersion(latest, bump)
  if (!own) {
    if (git(root, "tag", "--list", version)) throw new Error(`${version} already exists on another commit. Fetch the tags and look before releasing.`)
    const summary = body.match(/^- (.+)$/m)[1]
    git(root, "tag", "-a", version, sha, "-m", `${version}: ${summary}`)
  }
  return { version, notes: `Released ${date}.\n\n${body}` }
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  const option = (name) => { const index = rest.indexOf(`--${name}`); return index === -1 ? undefined : rest[index + 1] }
  const root = process.cwd()
  if (command === "check") {
    // CI passes the commit it compares with: --base for a pull request,
    // --before for a push. An empty one or all zeros (a run with no earlier
    // commit: nightly, by hand, a first push) is nothing to compare with.
    const given = (name) => { const value = option(name); return value && !/^0+$/.test(value) ? value : undefined }
    const { names, errors } = check(root, { base: given("base"), before: given("before") })
    if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; return }
    console.log(`${names.length} changelog ${names.length === 1 ? "file" : "files"} in changes/ checked.`)
  } else if (command === "release" && option("commit") && option("notes")) {
    const date = option("date") ?? new Date().toISOString().slice(0, 10)
    const result = release(root, option("commit"), date, (line) => console.error(line))
    if (!result) return
    writeFileSync(option("notes"), result.notes)
    console.log(result.version)
  } else if (command === "pending" && option("commit")) {
    const files = pending(root, option("commit"))
    if (!files.length) return
    console.log(files.join("\n"))
    console.error("Merged and not released yet. Wait for the Release run, or run it again, before tagging a release by hand.")
    process.exitCode = 1
  } else {
    throw new Error("Usage: release-notes.mjs check [--base <commit>] [--before <commit>] | release --commit <sha> --notes <file> [--date YYYY-MM-DD] | pending --commit <sha>")
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
