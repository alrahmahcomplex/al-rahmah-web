import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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
  // Commits the working tree. A commit on main is one origin/main has too.
  const commit = (message, seconds = 0) => {
    git("add", "-A")
    const result = spawnSync("git", ["commit", "-m", message], { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_COMMITTER_DATE: `${1_800_000_000 + seconds} +0000` } })
    assert.equal(result.status, 0, result.stderr)
    if (git("branch", "--show-current") === "main") git("update-ref", "refs/remotes/origin/main", "HEAD")
    return git("rev-parse", "HEAD")
  }
  const merge = (name, text, seconds) => {
    if (name) writeFileSync(join(dir, "changes", name), text)
    else writeFileSync(join(dir, "app.txt"), String(seconds))
    return commit(`Merge ${name ?? "code"}`, seconds)
  }
  git("init", "--initial-branch=main")
  git("config", "user.name", "Notes test")
  git("config", "user.email", "notes-test@example.invalid")
  git("config", "commit.gpgSign", "false")
  git("config", "tag.gpgSign", "false")
  writeFileSync(join(dir, "CHANGELOG.md"), history)
  mkdirSync(join(dir, "changes"))
  writeFileSync(join(dir, "changes", "README.md"), "# How\n")
  commit("Start")
  git("tag", "-a", "v0.10.0", "-m", "v0.10.0")
  return { dir, git, run, merge, commit }
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

test("check refuses a link in changes/, even one to a valid note", (t) => {
  const { dir, run } = repo(t)
  writeFileSync(join(dir, "real.txt"), note("patch", "### FIXED\n\n- X.\n"))
  try {
    symlinkSync(join(dir, "real.txt"), join(dir, "changes", "linked.md"))
  } catch (error) {
    // Windows without the right to make links: CI on Linux runs this.
    if (error.code === "EPERM") { t.diagnostic("no permission to make a link here"); return }
    throw error
  }
  assert.match(run("check").stderr, /plain file, not a link/)
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

test("a version already used on a commit off main is refused, not moved", (t) => {
  const { dir, git, merge, commit } = repo(t)
  const sha = merge("first.md", note("patch", "### FIXED\n\n- First fix.\n"), 1)
  // Someone tagged a commit of another branch with the version this merge would get.
  git("checkout", "--quiet", "-b", "elsewhere", "v0.10.0")
  writeFileSync(join(dir, "app.txt"), "elsewhere")
  const elsewhere = commit("Elsewhere")
  git("tag", "-a", "v0.10.1", "-m", "v0.10.1")
  git("checkout", "--quiet", "main")
  assert.throws(() => release(dir, sha, "2026-11-13"), /already exists/)
  assert.equal(git("rev-parse", "v0.10.1^{commit}"), elsewhere)
})

test("a merge that a later merge's release already covers releases nothing, and says where it went", (t) => {
  const { dir, git, merge, run } = repo(t)
  const earlier = merge("first.md", note("patch", "### FIXED\n\n- First fix.\n"), 1)
  const later = merge("second.md", note("patch", "### FIXED\n\n- Second fix.\n"), 2)
  // The later merge's run went first and took both files.
  assert.equal(release(dir, later, "2026-11-13").notes, "Released 2026-11-13.\n\n### FIXED\n\n- First fix.\n- Second fix.\n")
  const said = []
  assert.equal(release(dir, earlier, "2026-11-13", (line) => said.push(line)), null)
  assert.match(said.join("\n"), /already released in v0\.10\.1/)
  const again = run("release", "--commit", earlier, "--notes", join(dir, "notes.md"), "--date", "2026-11-13")
  assert.equal(again.status, 0, again.stderr)
  assert.equal(again.stdout, "")
  assert.match(again.stderr, /already released in v0\.10\.1/)
  assert.equal(git("tag", "--list", "v0.10.*"), "v0.10.0\nv0.10.1")
  assert.equal(git("rev-parse", "v0.10.1^{commit}"), later)
})

test("only a commit on origin/main is released: not another branch, not a merged branch's own commit", (t) => {
  const { dir, git, merge, commit } = repo(t)
  merge(null, "", 1)
  git("checkout", "--quiet", "-b", "feature")
  writeFileSync(join(dir, "changes", "feature.md"), note("minor", "### NEW\n\n- A feature.\n"))
  const unmerged = commit("Feature", 2)
  assert.throws(() => release(dir, unmerged, "2026-11-13"), /not a commit on origin\/main/)
  assert.equal(git("tag", "--list", "v0.11.0"), "")
  // Merged with a merge commit, the branch's commit is reachable from main
  // and still is not the commit main went through.
  git("checkout", "--quiet", "main")
  git("merge", "--quiet", "--no-ff", "-m", "Merge feature", "feature")
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  assert.throws(() => release(dir, unmerged, "2026-11-13"), /not a commit on origin\/main/)
  assert.equal(release(dir, git("rev-parse", "HEAD"), "2026-11-13").version, "v0.11.0")
  // With no origin/main at all there is nothing to compare with.
  git("update-ref", "-d", "refs/remotes/origin/main")
  assert.throws(() => release(dir, git("rev-parse", "HEAD"), "2026-11-13"), /origin\/main is not fetched/)
})

test("a version tag on a branch that is not merged is no release of main", (t) => {
  const { dir, git, merge, commit } = repo(t)
  const pending = merge("pending.md", note("patch", "### FIXED\n\n- A pending fix.\n"), 1)
  // A branch that starts at that merge and never reaches main gets a tag.
  git("checkout", "--quiet", "-b", "side")
  writeFileSync(join(dir, "app.txt"), "side")
  const side = commit("Side work", 2)
  git("tag", "-a", "v0.11.0", "-m", "v0.11.0")
  git("checkout", "--quiet", "main")
  assert.deepEqual(release(dir, pending, "2026-11-13"), { version: "v0.10.1", notes: "Released 2026-11-13.\n\n### FIXED\n\n- A pending fix.\n" })
  assert.equal(git("rev-parse", "v0.10.1^{commit}"), pending)
  assert.equal(git("rev-parse", "v0.11.0^{commit}"), side, "the other branch's tag stays where it is")
})

test("a version tag a merged branch brought along is not the release before this one", (t) => {
  const { dir, git, merge, commit } = repo(t)
  merge(null, "", 1)
  git("checkout", "--quiet", "-b", "side")
  writeFileSync(join(dir, "changes", "side.md"), note("minor", "### NEW\n\n- A side feature.\n"))
  commit("Side feature", 2)
  // Tagged on the branch, lightweight this time: no release of main made it.
  git("tag", "v0.20.0")
  writeFileSync(join(dir, "app.txt"), "more side work")
  commit("More side work", 3)
  git("checkout", "--quiet", "main")
  git("merge", "--quiet", "--no-ff", "-m", "Merge side", "side")
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  assert.deepEqual(release(dir, git("rev-parse", "HEAD"), "2026-11-13"), { version: "v0.11.0", notes: "Released 2026-11-13.\n\n### NEW\n\n- A side feature.\n" })
})

test("the Release workflow runs its job for main alone", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n")
  assert.match(workflow, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m)
  assert.match(workflow, /^ {2}push:\n {4}branches: \[main\]$/m)
})

test("check --base refuses a change that edits, deletes or renames a merged changelog file", (t) => {
  const { dir, git, merge, commit, run } = repo(t)
  const base = merge("old.md", note("patch", "### FIXED\n\n- Old fix.\n"), 1)
  const attempt = (verb, change) => {
    git("checkout", "--quiet", "-B", "work", base)
    change()
    commit(`A change that ${verb} old.md`)
    const result = run("check", "--base", base)
    assert.equal(result.status, 1, `${verb}: ${result.stdout}`)
    assert.match(result.stderr, new RegExp(`^changes/old\\.md is already merged and this change ${verb} it\\.`, "m"))
  }
  // A later PR on a branch of the same name, writing its entry over the old one.
  attempt("edits", () => writeFileSync(join(dir, "changes", "old.md"), note("minor", "### NEW\n\n- A new feature.\n")))
  attempt("deletes", () => rmSync(join(dir, "changes", "old.md")))
  attempt("renames", () => git("mv", "changes/old.md", "changes/moved.md"))
  // Deleted and replaced by another entry under the same name: still an edit.
  attempt("edits", () => { git("rm", "--quiet", "changes/old.md"); writeFileSync(join(dir, "changes", "old.md"), note("patch", "### FIXED\n\n- Another fix.\n")) })
})

test("check --base accepts a new file and a README.md edit, on a branch behind its base too", (t) => {
  const { dir, git, merge, commit, run } = repo(t)
  const base = merge("old.md", note("patch", "### FIXED\n\n- Old fix.\n"), 1)
  git("checkout", "--quiet", "-b", "work")
  writeFileSync(join(dir, "changes", "new.md"), note("minor", "### NEW\n\n- A new feature.\n"))
  writeFileSync(join(dir, "changes", "README.md"), "# How, said better\n")
  commit("A new changelog file")
  const result = run("check", "--base", base)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^2 changelog files/)
  // Main gains a file the branch never saw: the branch did not delete it.
  git("checkout", "--quiet", "main")
  const ahead = merge("later.md", note("patch", "### FIXED\n\n- Later fix.\n"), 2)
  git("checkout", "--quiet", "work")
  assert.equal(run("check", "--base", ahead).status, 0)
})

test("check --base with no commit to compare with checks the files alone, and an unknown commit fails", (t) => {
  const { dir, merge, commit, run } = repo(t)
  merge("old.md", note("patch", "### FIXED\n\n- Old fix.\n"), 1)
  writeFileSync(join(dir, "changes", "old.md"), note("patch", "### FIXED\n\n- Old fix, reworded.\n"))
  commit("Edit old.md")
  // A nightly or manual run has no base; a first push has all zeros.
  assert.equal(run("check", "--base", "").status, 0)
  assert.equal(run("check", "--base", "0".repeat(40)).status, 0)
  const unknown = run("check", "--base", "a".repeat(40))
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /Cannot compare changes\//)
})

test("check --before refuses a push that replaces main with a history without a merged file", (t) => {
  const { dir, git, merge, commit, run } = repo(t)
  const start = git("rev-parse", "HEAD")
  const before = merge("pending.md", note("patch", "### FIXED\n\n- A pending fix.\n"), 1)
  // A force-push: main now starts before the file was added, and never had it.
  git("checkout", "--quiet", "-B", "main", start)
  writeFileSync(join(dir, "app.txt"), "replacement")
  commit("Replacement main", 2)
  // The merge-base is the commit before the file, so --base sees nothing lost.
  assert.equal(run("check", "--base", before).status, 0)
  const result = run("check", "--before", before)
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stderr, /does not descend from/)
  // A commit the push left behind may not be fetched at all.
  const unknown = run("check", "--before", "a".repeat(40))
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /does not descend from/)
})

test("check --before accepts a fast-forward push, and refuses one that edits or deletes a merged file", (t) => {
  const { dir, merge, commit, run } = repo(t)
  const before = merge("old.md", note("patch", "### FIXED\n\n- Old fix.\n"), 1)
  merge(null, "", 2)
  const pushed = merge("new.md", note("minor", "### NEW\n\n- A new feature.\n"), 3)
  const result = run("check", "--before", before)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^2 changelog files/)
  rmSync(join(dir, "changes", "old.md"))
  commit("Delete old.md", 4)
  const deleted = run("check", "--before", pushed)
  assert.equal(deleted.status, 1, deleted.stdout)
  assert.match(deleted.stderr, /^changes\/old\.md is already merged and this change deletes it\./m)
  // A first push has all zeros, and a run that is no push has nothing.
  assert.equal(run("check", "--before", "0".repeat(40)).status, 0)
  assert.equal(run("check", "--base", "", "--before", "").status, 0)
})

test("CI compares a pull request with its base, and a push with main before the push", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n")
  assert.match(workflow, /^ {10}BASE: \$\{\{ github\.event\.pull_request\.base\.sha \}\}$/m)
  // A pull request's event has a `before` too, the branch's last head: only a
  // push may pass it.
  assert.match(workflow, /^ {10}BEFORE: \$\{\{ github\.event_name == 'push' && github\.event\.before \|\| '' \}\}$/m)
  assert.match(workflow, /^ {8}run: node scripts\/release-notes\.mjs check --base "\$BASE" --before "\$BEFORE"$/m)
})

test("a pending file a later merge deleted is still released, with its bump", (t) => {
  const { dir, merge, commit } = repo(t)
  merge("feature.md", note("minor", "### NEW\n\n- A feature.\n"), 1)
  // The release run for that merge failed or was dropped; the next merge
  // deletes the file and adds its own. check --base refuses such a pull
  // request; this is a push that went round it.
  rmSync(join(dir, "changes", "feature.md"))
  writeFileSync(join(dir, "changes", "fix.md"), note("patch", "### FIXED\n\n- A fix.\n"))
  assert.deepEqual(release(dir, commit("Merge fix", 2), "2026-11-13"), { version: "v0.11.0", notes: "Released 2026-11-13.\n\n### NEW\n\n- A feature.\n\n### FIXED\n\n- A fix.\n" })
})

// The v1.0.0 milestone as releasing.md has it: an entry in CHANGELOG.md,
// prepared with release.mjs and merged with no file in changes/.
function milestone(dir, commit) {
  const byHand = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("./release.mjs", import.meta.url)), ...args], { cwd: dir, encoding: "utf8" })
  writeFileSync(join(dir, "CHANGELOG.md"), history.replace("## October", "## Unreleased\n\n### NEW\n\n- The complete app.\n\n## October"))
  const prepared = byHand("prepare", "--bump", "major", "--complete-app", "--date", "2026-11-13")
  assert.equal(prepared.status, 0, prepared.stderr)
  const sha = commit("Merge the milestone", 2)
  return { sha, tag: () => byHand("tag", "--commit", sha) }
}

test("a milestone is not tagged by hand while a merged changelog file is not released yet", (t) => {
  const { dir, git, merge, commit, run } = repo(t)
  // Its release run was queued or dropped.
  const earlier = merge("pending.md", note("patch", "### FIXED\n\n- A pending fix.\n"), 1)
  const { sha, tag } = milestone(dir, commit)
  const listed = run("pending", "--commit", sha)
  assert.equal(listed.status, 1, listed.stderr)
  assert.equal(listed.stdout.trim(), "changes/pending.md")
  const refused = tag()
  assert.equal(refused.status, 1, refused.stdout)
  assert.match(refused.stderr, /^changes\/pending\.md$/m)
  assert.match(refused.stderr, /not released yet/)
  assert.equal(git("tag", "--list", "v1.0.0"), "", "nothing is tagged")
  // The outstanding run, run again, releases the file. Then the milestone goes.
  assert.equal(release(dir, earlier, "2026-11-13").notes, "Released 2026-11-13.\n\n### FIXED\n\n- A pending fix.\n")
  const clear = run("pending", "--commit", sha)
  assert.equal(clear.status, 0, clear.stderr)
  assert.equal(clear.stdout, "")
  const tagged = tag()
  assert.equal(tagged.status, 0, tagged.stderr)
  assert.equal(git("rev-parse", "v1.0.0^{commit}"), sha)
  assert.equal(git("tag", "--list", "v*"), "v0.10.0\nv0.10.1\nv1.0.0")
  // The next release starts from the milestone, with nothing left behind it.
  const next = merge("next.md", note("patch", "### FIXED\n\n- Next fix.\n"), 3)
  assert.deepEqual(release(dir, next, "2026-11-14"), { version: "v1.0.1", notes: "Released 2026-11-14.\n\n### FIXED\n\n- Next fix.\n" })
})

test("a pending file released on the milestone's own commit leaves the milestone free to be tagged there", (t) => {
  const { dir, git, merge, commit } = repo(t)
  merge("pending.md", note("patch", "### FIXED\n\n- A pending fix.\n"), 1)
  const { sha, tag } = milestone(dir, commit)
  assert.equal(tag().status, 1)
  // The Release workflow, started by hand on main, tags the newest commit.
  assert.equal(release(dir, sha, "2026-11-13").version, "v0.10.1")
  assert.equal(tag().status, 0)
  assert.equal(git("rev-parse", "v1.0.0^{commit}"), sha)
  assert.equal(git("rev-parse", "v0.10.1^{commit}"), sha)
  // Run again on that commit, the workflow has nothing more to release.
  assert.equal(release(dir, sha, "2026-11-13"), null)
})

test("a milestone is not tagged by hand behind a release on a later merge", (t) => {
  const { dir, git, merge, commit, run } = repo(t)
  const { sha, tag } = milestone(dir, commit)
  // An app PR merges and is released before the milestone is tagged.
  const later = merge("later.md", note("patch", "### FIXED\n\n- A later fix.\n"), 3)
  assert.equal(release(dir, later, "2026-11-13").version, "v0.10.1")
  // Nothing is pending, yet v1.0.0 here would be where the next release
  // starts, and later.md would be published again.
  const clear = run("pending", "--commit", sha)
  assert.equal(clear.status, 0, clear.stderr)
  assert.equal(clear.stdout, "")
  const refused = tag()
  assert.equal(refused.status, 1, refused.stdout)
  assert.match(refused.stderr, /v1\.0\.0 was not tagged\. v0\.10\.1 already tags a later commit on main/)
  assert.match(refused.stderr, /Tag the milestone before later releases, or prepare it on a commit after them\./)
  assert.equal(git("tag", "--list", "v*"), "v0.10.0\nv0.10.1", "nothing is tagged")
  // The next release still starts from the later one, and publishes only its own file.
  const next = merge("next.md", note("patch", "### FIXED\n\n- Next fix.\n"), 4)
  assert.deepEqual(release(dir, next, "2026-11-14"), { version: "v0.10.2", notes: "Released 2026-11-14.\n\n### FIXED\n\n- Next fix.\n" })
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
