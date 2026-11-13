import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { combine, insertEntry, parseNote } from "./release-notes.mjs"

const notes = fileURLToPath(new URL("./release-notes.mjs", import.meta.url))
const release = fileURLToPath(new URL("./release.mjs", import.meta.url))
const history = "# Changelog\n\nIntro.\n\n## October 1, 2026 `v0.10.0`\n\n### NEW\n\n- Existing app.\n"
const note = (bump, body) => `---\nbump: ${bump}\n---\n\n${body}`

test("a valid note gives its bump and sections, with Windows line endings too", () => {
  const parsed = parseNote("a.md", note("minor", "### NEW\n\n- Staff can do X.\n  It wraps.\n\n### FIXED\n\n- Y works.\n").replace(/\n/g, "\r\n"))
  assert.deepEqual(parsed, { bump: "minor", sections: { NEW: "- Staff can do X.\n  It wraps.", FIXED: "- Y works." }, errors: [] })
})

test("a note without a valid bump, sections or bullets is refused with its name", () => {
  const bad = [
    "### NEW\n\n- No front matter.\n",
    note("major", "### NEW\n\n- Too big.\n"),
    note("patch", "Some text.\n\n### FIXED\n\n- Fix.\n"),
    note("patch", "### CHANGED\n\n- Wrong heading.\n"),
    note("patch", "### FIXED\n\nNo bullet.\n"),
    note("patch", "### FIXED\n\n- One.\n\n### FIXED\n\n- Two.\n"),
    note("patch", "### FIXED\n\n- One.\n\n## November 1, 2026 `v1.0.0`\n"),
    note("patch", ""),
  ]
  for (const text of bad) {
    const parsed = parseNote("bad.md", text)
    assert.ok(parsed.errors.length, text)
    assert.ok(parsed.errors.every((error) => error.startsWith("bad.md: ")), parsed.errors.join("\n"))
  }
})

test("several notes make one entry in section order, oldest first, with the larger bump", () => {
  const first = parseNote("a.md", note("patch", "### FIXED\n\n- A fix.\n"))
  const second = parseNote("b.md", note("minor", "### FIXED\n\n- B fix.\n\n### NEW\n\n- B new.\n"))
  assert.deepEqual(combine([first, second]), { bump: "minor", entry: "## Unreleased\n\n### NEW\n\n- B new.\n\n### FIXED\n\n- A fix.\n- B fix.\n\n" })
  assert.equal(combine([first]).bump, "patch")
})

test("the entry goes above the newest release, below the intro", () => {
  assert.equal(insertEntry(history, "## Unreleased\n\n### FIXED\n\n- X.\n\n"), history.replace("## October", "## Unreleased\n\n### FIXED\n\n- X.\n\n## October"))
})

function repo(t) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "alrahmah-notes-test-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" })
  git("init", "--initial-branch=main")
  git("config", "user.name", "Notes test")
  git("config", "user.email", "notes-test@example.invalid")
  git("config", "commit.gpgSign", "false")
  git("config", "tag.gpgSign", "false")
  writeFileSync(join(dir, "CHANGELOG.md"), history)
  mkdirSync(join(dir, "changes"))
  writeFileSync(join(dir, "changes", "README.md"), "# How\n")
  git("add", "-A")
  git("commit", "-m", "Start")
  git("tag", "-a", "v0.10.0", "-m", "v0.10.0")
  return { dir, git, run }
}

test("check refuses an Unreleased entry in CHANGELOG.md and a bad note; README.md is not a note", (t) => {
  const { dir, run } = repo(t)
  assert.equal(run(notes, "check").status, 0)
  writeFileSync(join(dir, "CHANGELOG.md"), insertEntry(history, "## Unreleased\n\n### FIXED\n\n- X.\n\n"))
  assert.match(run(notes, "check").stderr, /Unreleased/)
  writeFileSync(join(dir, "CHANGELOG.md"), history)
  writeFileSync(join(dir, "changes", "bad.md"), "no front matter\n")
  const result = run(notes, "check")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /^bad\.md: /m)
})

test("after two merges, collect and release.mjs make one dated, versioned and tagged release", (t) => {
  const { dir, git, run } = repo(t)
  writeFileSync(join(dir, "changes", "first.md"), note("patch", "### FIXED\n\n- First fix.\n"))
  git("add", "-A")
  git("commit", "-m", "First merge", "--date", "2026-11-13T08:00:00Z")
  writeFileSync(join(dir, "changes", "second.md"), note("minor", "### NEW\n\n- Second feature.\n"))
  git("add", "-A")
  git("commit", "-m", "Second merge", "--date", "2026-11-13T09:00:00Z")
  git("update-ref", "refs/remotes/origin/main", "HEAD")

  const collected = run(notes, "collect")
  assert.equal(collected.status, 0, collected.stderr)
  assert.equal(collected.stdout.trim(), "minor")
  assert.ok(!existsSync(join(dir, "changes", "first.md")) && !existsSync(join(dir, "changes", "second.md")))
  assert.ok(existsSync(join(dir, "changes", "README.md")))

  const prepared = run(release, "prepare", "--bump", "minor", "--date", "2026-11-13", "--base", "origin/main")
  assert.equal(prepared.status, 0, prepared.stderr)
  assert.equal(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), history.replace("## October", "## November 13, 2026 `v0.11.0`\n\n### NEW\n\n- Second feature.\n\n### FIXED\n\n- First fix.\n\n## October"))

  git("add", "-A")
  git("commit", "-m", "Release v0.11.0")
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  const tagged = run(release, "tag", "--commit", git("rev-parse", "HEAD"))
  assert.equal(tagged.status, 0, tagged.stderr)
  assert.equal(git("tag", "--list", "v0.11.0"), "v0.11.0")
  assert.equal(run(notes, "collect").stdout, "", "nothing is left to release")
})
