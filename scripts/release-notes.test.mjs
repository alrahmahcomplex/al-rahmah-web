import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { combine, nextVersion, parseNote, release } from "./release-notes.mjs"

const script = fileURLToPath(new URL("./release-notes.mjs", import.meta.url))
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

test("several notes make one body in section order, oldest first, with the larger bump", () => {
  const first = parseNote("a.md", note("patch", "### FIXED\n\n- A fix.\n"))
  const second = parseNote("b.md", note("minor", "### FIXED\n\n- B fix.\n\n### NEW\n\n- B new.\n"))
  assert.deepEqual(combine([first, second]), { bump: "minor", body: "### NEW\n\n- B new.\n\n### FIXED\n\n- A fix.\n- B fix.\n" })
  assert.equal(combine([first]).bump, "patch")
})

test("the next version follows the bump", () => {
  assert.equal(nextVersion("v0.107.0", "patch"), "v0.107.1")
  assert.equal(nextVersion("v0.107.3", "minor"), "v0.108.0")
})

function repo(t) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "alrahmah-notes-test-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" })
  const merge = (name, text, seconds) => {
    if (name) writeFileSync(join(dir, "changes", name), text)
    else writeFileSync(join(dir, "app.txt"), String(seconds))
    git("add", "-A")
    const result = spawnSync("git", ["commit", "-m", `Merge ${name ?? "code"}`], { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_COMMITTER_DATE: `${1_800_000_000 + seconds} +0000` } })
    assert.equal(result.status, 0, result.stderr)
    return git("rev-parse", "HEAD")
  }
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
  return { dir, git, run, merge }
}

test("check refuses an Unreleased entry, a bad note, a folder and a non-.md file; README.md is not a note", (t) => {
  const { dir, run } = repo(t)
  assert.equal(run("check").status, 0)
  writeFileSync(join(dir, "CHANGELOG.md"), history.replace("## October", "## Unreleased\n\n### FIXED\n\n- X.\n\n## October"))
  assert.match(run("check").stderr, /Unreleased/)
  writeFileSync(join(dir, "CHANGELOG.md"), history)
  writeFileSync(join(dir, "changes", "bad.md"), "no front matter\n")
  assert.match(run("check").stderr, /^bad\.md: /m)
  rmSync(join(dir, "changes", "bad.md"))
  mkdirSync(join(dir, "changes", "feature"))
  writeFileSync(join(dir, "changes", "feature", "x.md"), note("patch", "### FIXED\n\n- X.\n"))
  assert.match(run("check").stderr, /no folders/)
  rmSync(join(dir, "changes", "feature"), { recursive: true })
  writeFileSync(join(dir, "changes", "x.txt"), note("patch", "### FIXED\n\n- X.\n"))
  assert.match(run("check").stderr, /ends in \.md/)
})

test("a merge with a changelog file is tagged with the next version, and its notes name the date", (t) => {
  const { dir, git, merge } = repo(t)
  const sha = merge("fix.md", note("patch", "### FIXED\n\n- Staff can save.\n"), 1)
  assert.deepEqual(release(dir, sha, "2026-11-13"), { version: "v0.10.1", notes: "Released 2026-11-13.\n\n### FIXED\n\n- Staff can save.\n" })
  assert.equal(git("rev-parse", "v0.10.1^{commit}"), sha)
  assert.equal(git("cat-file", "-t", "v0.10.1"), "tag", "an annotated tag")
  assert.match(git("tag", "-l", "--format=%(contents:subject)", "v0.10.1"), /^v0\.10\.1: Staff can save\.$/)
  assert.equal(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), history, "nothing is committed or changed")
})

test("two merges released together take both files, oldest first, and the larger bump", (t) => {
  const { dir, merge } = repo(t)
  merge("first.md", note("patch", "### FIXED\n\n- First fix.\n"), 1)
  const second = merge("second.md", note("minor", "### NEW\n\n- Second feature.\n"), 2)
  assert.deepEqual(release(dir, second, "2026-11-13"), { version: "v0.11.0", notes: "Released 2026-11-13.\n\n### NEW\n\n- Second feature.\n\n### FIXED\n\n- First fix.\n" })
})

test("a file already released is not released again, and a merge with no new file releases nothing", (t) => {
  const { dir, merge } = repo(t)
  const first = merge("first.md", note("patch", "### FIXED\n\n- First fix.\n"), 1)
  assert.equal(release(dir, first, "2026-11-13").version, "v0.10.1")
  const code = merge(null, "", 2)
  assert.equal(release(dir, code, "2026-11-14"), null)
  const next = merge("next.md", note("patch", "### FIXED\n\n- Next fix.\n"), 3)
  assert.deepEqual(release(dir, next, "2026-11-14"), { version: "v0.10.2", notes: "Released 2026-11-14.\n\n### FIXED\n\n- Next fix.\n" })
})

test("run again on a commit it already tagged, it gives the same release, so a failed push or publish can finish", (t) => {
  const { dir, git, merge } = repo(t)
  const sha = merge("fix.md", note("patch", "### FIXED\n\n- Staff can save.\n"), 1)
  const first = release(dir, sha, "2026-11-13")
  assert.deepEqual(release(dir, sha, "2026-11-13"), first)
  assert.equal(git("tag", "--list", "v0.10.*"), "v0.10.0\nv0.10.1")
})

test("a version already used on another commit is refused, not moved", (t) => {
  const { dir, git, merge } = repo(t)
  const earlier = merge("first.md", note("patch", "### FIXED\n\n- First fix.\n"), 1)
  git("branch", "elsewhere", earlier)
  const later = merge("second.md", note("patch", "### FIXED\n\n- Second fix.\n"), 2)
  release(dir, later, "2026-11-13")
  assert.throws(() => release(dir, earlier, "2026-11-13"), /already exists/)
  assert.equal(git("rev-parse", "v0.10.1^{commit}"), later)
})

test("a pending file a later merge deleted is still released, with its bump", (t) => {
  const { dir, git, merge } = repo(t)
  merge("feature.md", note("minor", "### NEW\n\n- A feature.\n"), 1)
  // The release run for that merge failed or was dropped; the next merge
  // deletes the file and adds its own.
  rmSync(join(dir, "changes", "feature.md"))
  writeFileSync(join(dir, "changes", "fix.md"), note("patch", "### FIXED\n\n- A fix.\n"))
  git("add", "-A")
  const result = spawnSync("git", ["commit", "-m", "Merge fix"], { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_COMMITTER_DATE: `${1_800_000_002} +0000` } })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(release(dir, git("rev-parse", "HEAD"), "2026-11-13"), { version: "v0.11.0", notes: "Released 2026-11-13.\n\n### NEW\n\n- A feature.\n\n### FIXED\n\n- A fix.\n" })
})

test("a file name git would quote is still found, and check asks for plain names", (t) => {
  const { dir, merge, run } = repo(t)
  const sha = merge("café.md", note("patch", "### FIXED\n\n- Accents work.\n"), 1)
  assert.equal(release(dir, sha, "2026-11-13").version, "v0.10.1")
  assert.match(run("check").stderr, /lower-case letters/)
})

test("the CLI writes the notes file and prints the version, or prints nothing", (t) => {
  const { dir, merge, run } = repo(t)
  const code = merge(null, "", 1)
  const none = run("release", "--commit", code, "--notes", join(dir, "notes.md"), "--date", "2026-11-13")
  assert.equal(none.status, 0, none.stderr)
  assert.equal(none.stdout, "")
  const sha = merge("fix.md", note("patch", "### FIXED\n\n- Staff can save.\n"), 2)
  const result = run("release", "--commit", sha, "--notes", join(dir, "notes.md"), "--date", "2026-11-13")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), "v0.10.1")
  assert.equal(readFileSync(join(dir, "notes.md"), "utf8"), "Released 2026-11-13.\n\n### FIXED\n\n- Staff can save.\n")
})
