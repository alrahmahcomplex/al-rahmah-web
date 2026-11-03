import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const versionPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const usage = "Usage: node scripts/release.mjs prepare --bump patch|minor|major --date YYYY-MM-DD [--base origin/main] [--complete-app]\n       node scripts/release.mjs tag --commit <full merge SHA>"

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd()
}

function versionParts(version) {
  return version.match(versionPattern).slice(1).map(BigInt)
}

function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

function sections(content) {
  const headings = [...content.matchAll(/^## ([^\r\n]+)\r?$/gm)]
  return headings.map((match, index) => ({
    title: match[1],
    start: match.index,
    end: headings[index + 1]?.index ?? content.length,
    body: content.slice(match.index + match[0].length, headings[index + 1]?.index).trim(),
  }))
}

function parseArguments(args) {
  const [command, ...flags] = args
  const allowed = command === "prepare" ? ["bump", "date", "base", "complete-app"] : command === "tag" ? ["commit"] : []
  if (!allowed.length) throw new Error(usage)
  const options = {}
  for (let index = 0; index < flags.length; index++) {
    const key = flags[index].slice(2)
    if (!flags[index].startsWith("--") || !allowed.includes(key) || Object.hasOwn(options, key)) {
      throw new Error(`Unknown or repeated argument: ${flags[index]}.\n${usage}`)
    }
    if (key === "complete-app") options[key] = true
    else {
      const value = flags[++index]
      if (!value || value.startsWith("-")) throw new Error(`Missing value for --${key}.`)
      options[key] = value
    }
  }
  if (command === "prepare") {
    if (!["patch", "minor", "major"].includes(options.bump)) throw new Error("Choose --bump patch, minor or major.")
    const date = new Date(`${options.date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date ?? "") || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== options.date) {
      throw new Error("Provide a real calendar date with --date YYYY-MM-DD.")
    }
  }
  return { command, options }
}

function prepare(options) {
  const base = options.base ?? "origin/main"
  const baseCommit = git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`)
  git("merge-base", "--is-ancestor", baseCommit, "HEAD")
  const baseContent = git("show", `${baseCommit}:CHANGELOG.md`)
  const baseSections = sections(baseContent)
  if (baseSections.some((section) => section.title === "Unreleased" && section.body)) {
    throw new Error(`Unreleased notes already exist on ${base}. Separate the inherited notes before preparing this release.`)
  }
  const versions = git("tag", "--merged", baseCommit).split("\n").filter((tag) => versionPattern.test(tag))
  const latest = versions.sort(compareVersions).at(-1)
  if (!latest) throw new Error(`No stable vX.Y.Z tag is reachable from ${base}.`)
  const next = versionParts(latest)
  if (next[0] === 0n && options.bump === "major" && !options["complete-app"]) {
    throw new Error("v1.0.0 is reserved for the complete app. Use --complete-app only when that milestone is approved.")
  }
  const index = ["major", "minor", "patch"].indexOf(options.bump)
  next[index]++
  for (let rest = index + 1; rest < 3; rest++) next[rest] = 0n
  const version = `v${next.join(".")}`
  if (git("tag", "--list", version)) throw new Error(`${version} already exists. Fetch the latest main and tags before preparing.`)
  const date = new Date(`${options.date}T00:00:00Z`)
  const displayDate = date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
  const path = join(git("rev-parse", "--show-toplevel"), "CHANGELOG.md")
  const content = readFileSync(path, "utf8")
  const currentSections = sections(content)
  const first = currentSections[0]
  const heading = `${displayDate} \`${version}\``
  if (!first || !["Unreleased", heading].includes(first.title) || !/^- \S/m.test(first.body)) {
    throw new Error("Expected a nonempty top Unreleased entry, or this exact prepared release.")
  }
  if (currentSections.slice(1).some((section) => section.title === "Unreleased" || section.title.includes(`\`${version}\``))) {
    throw new Error("Duplicate Unreleased or release headings. Separate the entries before preparing.")
  }
  const baseHistory = baseSections.find((section) => section.title !== "Unreleased")
  const normalize = (text) => text.replaceAll("\r\n", "\n").trim()
  if (!baseHistory || normalize(content.slice(first.end)) !== normalize(baseContent.slice(baseHistory.start))) {
    throw new Error("Released history differs from the base. Preserve older entries before preparing this release.")
  }
  if (first.title === heading) {
    console.log(`${version} is already prepared.`)
    return
  }
  writeFileSync(path, content.replace(/^## Unreleased(?=\r?$)/m, `## ${heading}`))
  console.log(`Prepared ${version}. Review and commit CHANGELOG.md before merging.`)
}

function tagRelease(options) {
  const commit = options.commit
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit ?? "")) throw new Error("Provide the full merge commit SHA with --commit.")
  if (!git("rev-list", "--first-parent", "origin/main").split("\n").includes(commit)) {
    throw new Error("The commit is not in fetched origin/main's first-parent history. Fetch main and supply the merge SHA.")
  }
  const first = sections(git("show", `${commit}:CHANGELOG.md`))[0]
  const match = first?.title.match(/^([A-Z][a-z]+ \d{1,2}, \d{4}) `(v\d+\.\d+\.\d+)`$/)
  if (!match || !versionPattern.test(match[2])) throw new Error("The commit has no top dated release entry.")
  const date = new Date(`${match[1]} 00:00:00 UTC`)
  if (date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) !== match[1]) {
    throw new Error("The release heading has an invalid calendar date.")
  }
  const version = match[2]
  const parentSections = sections(git("show", `${commit}^1:CHANGELOG.md`))
  if (parentSections.some((section) => section.title.includes(`\`${version}\``))) {
    throw new Error(`This commit inherited ${version}; tag the commit that introduced the release entry.`)
  }
  const summary = first.body.match(/^- (\S[^\r\n]*(?:\r?\n {2,}\S[^\r\n]*)*)/m)?.[1].replace(/\s+/g, " ")
  if (!summary) throw new Error("The release entry needs a changelog bullet for the tag message.")
  if (git("tag", "--list", version)) {
    if (git("rev-parse", `${version}^{commit}`) !== commit || git("cat-file", "-t", `refs/tags/${version}`) !== "tag") {
      throw new Error(`${version} already exists as a different or unannotated tag. It was not changed.`)
    }
    console.log(`${version} already tags ${commit}.`)
    return
  }
  git("tag", "-a", version, commit, "-m", `${version}: ${summary}`)
  console.log(`Created local tag ${version} at ${commit}. Push it after checking the release.`)
}

try {
  const { command, options } = parseArguments(process.argv.slice(2))
  if (command === "prepare") prepare(options)
  else tagRelease(options)
} catch (error) {
  console.error(`Release failed: ${error.message}`)
  process.exitCode = 1
}
