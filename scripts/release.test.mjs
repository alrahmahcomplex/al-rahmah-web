import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const script = fileURLToPath(new URL("./release.mjs", import.meta.url))
const initial = "# Changelog\n\n## October 1, 2026 `v0.10.0`\n\n### NEW\n\n- Existing app.\n"
const entry = "## Unreleased\n\n### FIXED\n\n- Staff can save their changes.\n\n"

function fixture(t, changelog = initial) {
  const temporaryRoot = realpathSync(tmpdir())
  const directory = mkdtempSync(join(temporaryRoot, "alrahmah-release-test-"))
  t.after(() => {
    const child = relative(temporaryRoot, resolve(directory))
    assert.match(child, /^alrahmah-release-test-[^\\/]+$/)
    rmSync(directory, { recursive: true, force: true })
  })
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const write = (text) => writeFileSync(join(directory, "CHANGELOG.md"), text)
  const read = () => readFileSync(join(directory, "CHANGELOG.md"), "utf8")
  const commit = () => {
    git("add", "CHANGELOG.md")
    git("commit", "-m", "Change app")
    return git("rev-parse", "HEAD")
  }
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    cwd: directory, encoding: "utf8",
  })
  git("init", "--initial-branch=main")
  git("config", "user.name", "Release test")
  git("config", "user.email", "release-test@example.invalid")
  git("config", "commit.gpgSign", "false")
  git("config", "tag.gpgSign", "false")
  write(changelog)
  commit()
  git("tag", "v0.10.0")
  git("tag", "v0.9.9")
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  git("switch", "-c", "task")
  return { git, write, read, commit, run }
}

test("prepare uses the highest stable version on main and keeps older entries", (t) => {
  const repo = fixture(t)
  repo.write(initial.replace("## October", `${entry}## October`))
  const result = repo.run("prepare", "--bump", "patch", "--date", "2026-11-03")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(repo.read(), initial.replace("## October", `${entry.replace("## Unreleased", "## November 3, 2026 `v0.10.1`")}## October`))
  assert.equal(repo.git("tag", "--list", "v0.10.1"), "")
})

test("prepare refuses inherited Unreleased notes without changing the file", (t) => {
  const inherited = initial.replace("## October", "## Unreleased\n\n### NEW\n\n- Another task's feature.\n\n## October")
  const repo = fixture(t, inherited)
  const content = inherited.replace("### NEW", "### FIXED\n\n- My correction.\n\n### NEW")
  repo.write(content)
  const result = repo.run("prepare", "--bump", "patch", "--date", "2026-11-03")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /inherited|Unreleased/i)
  assert.equal(repo.read(), content)
})

test("invalid arguments and impossible dates do not change files", (t) => {
  const repo = fixture(t)
  const content = initial.replace("## October", `${entry}## October`)
  const invalid = [
    [], ["publish"],
    ["prepare", "--bump", "tiny", "--date", "2026-11-03"],
    ["prepare", "--bump", "patch"],
    ["prepare", "--bump", "patch", "--date", "2026-02-30"],
    ["prepare", "--bump", "patch", "--date", "2026-13-01"],
    ["prepare", "--bump", "patch", "--date", "11/03/2026"],
    ["prepare", "--bump", "patch", "--date", "2026-11-03", "--push"],
    ["prepare", "--bump", "patch", "--bump", "minor", "--date", "2026-11-03"],
    ["prepare", "--bump", "patch", "--date", "2026-11-03", "--base", "--all"],
  ]
  for (const args of invalid) {
    repo.write(content)
    const result = repo.run(...args)
    assert.notEqual(result.status, 0, args.join(" "))
    assert.equal(repo.read(), content, args.join(" "))
  }
})

test("prepare requires explicit confirmation to release the complete app", (t) => {
  const repo = fixture(t)
  const content = initial.replace("## October", `${entry}## October`)
  repo.write(content)
  const denied = repo.run("prepare", "--bump", "major", "--date", "2026-11-03")
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /complete-app/)
  assert.equal(repo.read(), content)
  const confirmed = repo.run("prepare", "--bump", "major", "--date", "2026-11-03", "--complete-app")
  assert.equal(confirmed.status, 0, confirmed.stderr)
  assert.match(repo.read(), /## November 3, 2026 `v1\.0\.0`/)
})

test("prepare requires one new entry and refuses ambiguous changelog changes", (t) => {
  const repo = fixture(t)
  const cases = [
    initial,
    initial.replace("## October", "## Unreleased\n\n### FIXED\n\n## October"),
    initial.replace("## October", `${entry}${entry}## October`),
    initial.replace("## October", `${entry}## October`).replace("Existing app.", "Rewritten history."),
    initial.replace("## October", `${entry}## November 3, 2026 \`v0.10.1\`\n\n- Duplicate release.\n\n## October`),
  ]
  for (const content of cases) {
    repo.write(content)
    const result = repo.run("prepare", "--bump", "patch", "--date", "2026-11-03")
    assert.notEqual(result.status, 0, content)
    assert.equal(repo.read(), content)
  }
})

test("repeating prepare is a no-op and preserves Windows line endings", (t) => {
  const repo = fixture(t)
  repo.write(initial.replace("## October", `${entry}## October`).replaceAll("\n", "\r\n"))
  const args = ["prepare", "--bump", "patch", "--date", "2026-11-03"]
  assert.equal(repo.run(...args).status, 0)
  const prepared = repo.read()
  const repeated = repo.run(...args)
  assert.equal(repeated.status, 0, repeated.stderr)
  assert.equal(repo.read(), prepared)
  assert.match(repeated.stdout, /already prepared/i)
  assert.equal(prepared.replaceAll("\r\n", "").includes("\n"), false)
  assert.equal((prepared.match(/v0\.10\.1/g) ?? []).length, 1)
})

test("tag creates one annotated local tag from the committed release and can repeat", (t) => {
  const repo = fixture(t)
  repo.write(initial.replace("## October", `${entry}## October`))
  assert.equal(repo.run("prepare", "--bump", "patch", "--date", "2026-11-03").status, 0)
  const commit = repo.commit()
  repo.git("update-ref", "refs/remotes/origin/main", commit)
  repo.write("Uncommitted text must not supply the release version.\n")
  const result = repo.run("tag", "--commit", commit)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(repo.git("rev-parse", "v0.10.1^{commit}"), commit)
  assert.equal(repo.git("cat-file", "-t", "refs/tags/v0.10.1"), "tag")
  assert.match(repo.git("cat-file", "-p", "refs/tags/v0.10.1"), /v0\.10\.1: Staff can save their changes\./)
  const tagObject = repo.git("rev-parse", "refs/tags/v0.10.1")
  const repeated = repo.run("tag", "--commit", commit)
  assert.equal(repeated.status, 0, repeated.stderr)
  assert.match(repeated.stdout, /already tags/i)
  assert.equal(repo.git("rev-parse", "refs/tags/v0.10.1"), tagObject)
})

test("tag rejects unmerged commits and later commits that merely inherit a release", (t) => {
  const repo = fixture(t)
  repo.write(initial.replace("## October", `${entry}## October`))
  assert.equal(repo.run("prepare", "--bump", "patch", "--date", "2026-11-03").status, 0)
  const release = repo.commit()
  assert.notEqual(repo.run("tag", "--commit", release).status, 0)
  for (const value of ["HEAD", release.slice(0, 8), "--all"]) {
    assert.notEqual(repo.run("tag", "--commit", value).status, 0)
  }
  repo.git("commit", "--allow-empty", "-m", "Unrelated documentation")
  const unrelated = repo.git("rev-parse", "HEAD")
  repo.git("update-ref", "refs/remotes/origin/main", unrelated)
  const result = repo.run("tag", "--commit", unrelated)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /introduce|inherited/i)
  assert.equal(repo.git("tag", "--list", "v0.10.1"), "")
  assert.equal(repo.run("tag", "--commit", release).status, 0)
})

test("a merge release tags the main commit, not a feature branch ancestor", (t) => {
  const repo = fixture(t)
  repo.write(initial.replace("## October", `${entry}## October`))
  assert.equal(repo.run("prepare", "--bump", "patch", "--date", "2026-11-03").status, 0)
  const branchCommit = repo.commit()
  repo.git("switch", "main")
  repo.git("merge", "--no-ff", "task", "-m", "Merge app correction")
  const merge = repo.git("rev-parse", "HEAD")
  repo.git("update-ref", "refs/remotes/origin/main", merge)
  assert.notEqual(repo.run("tag", "--commit", branchCommit).status, 0)
  const result = repo.run("tag", "--commit", merge)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(repo.git("rev-parse", "v0.10.1^{commit}"), merge)
})

test("prepare refuses a next-version tag already used on another branch", (t) => {
  const repo = fixture(t)
  repo.git("commit", "--allow-empty", "-m", "Unmerged change")
  repo.git("tag", "v0.10.1")
  const content = initial.replace("## October", `${entry}## October`)
  repo.write(content)
  const result = repo.run("prepare", "--bump", "patch", "--date", "2026-11-03")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /already exists/)
  assert.equal(repo.read(), content)
})

test("tag never overwrites a conflicting or lightweight tag", (t) => {
  const repo = fixture(t)
  repo.write(initial.replace("## October", `${entry}## October`))
  assert.equal(repo.run("prepare", "--bump", "patch", "--date", "2026-11-03").status, 0)
  const release = repo.commit()
  repo.git("update-ref", "refs/remotes/origin/main", release)
  repo.git("tag", "-a", "v0.10.1", "HEAD^", "-m", "Existing tag")
  const existing = repo.git("rev-parse", "refs/tags/v0.10.1")
  const conflict = repo.run("tag", "--commit", release)
  assert.notEqual(conflict.status, 0)
  assert.equal(repo.git("rev-parse", "refs/tags/v0.10.1"), existing)
  repo.git("tag", "-d", "v0.10.1")
  repo.git("tag", "v0.10.1", release)
  assert.notEqual(repo.run("tag", "--commit", release).status, 0)
  assert.equal(repo.git("cat-file", "-t", "refs/tags/v0.10.1"), "commit")
})

test("minor releases ignore prereleases and tags outside the selected base", (t) => {
  const repo = fixture(t, initial.replace("## October", "## Unreleased\n\n## October"))
  repo.git("tag", "v9.0.0-rc.1", "main")
  repo.git("tag", "v01.0.0", "main")
  repo.git("commit", "--allow-empty", "-m", "Unmerged change")
  repo.git("tag", "v99.0.0")
  repo.write(initial.replace("## October", `${entry}## October`))
  const result = repo.run("prepare", "--bump", "minor", "--date", "2028-02-29", "--base", "main")
  assert.equal(result.status, 0, result.stderr)
  assert.match(repo.read(), /## February 29, 2028 `v0\.11\.0`/)
})

test("major releases after 1.0 follow SemVer without the completion flag", (t) => {
  const repo = fixture(t)
  repo.git("tag", "v1.2.3", "main")
  repo.write(initial.replace("## October", `${entry}## October`))
  const result = repo.run("prepare", "--bump", "major", "--date", "2026-11-03")
  assert.equal(result.status, 0, result.stderr)
  assert.match(repo.read(), /`v2\.0\.0`/)
})

test("prepare requires a tagged base already incorporated into the branch", (t) => {
  const repo = fixture(t)
  const content = initial.replace("## October", `${entry}## October`)
  repo.git("switch", "main")
  repo.git("commit", "--allow-empty", "-m", "New main change")
  repo.git("update-ref", "refs/remotes/origin/main", "HEAD")
  repo.git("switch", "task")
  repo.write(content)
  assert.notEqual(repo.run("prepare", "--bump", "patch", "--date", "2026-11-03").status, 0)
  assert.equal(repo.read(), content)
  repo.git("tag", "-d", "v0.10.0", "v0.9.9")
  const noTags = repo.run("prepare", "--bump", "patch", "--date", "2026-11-03", "--base", "HEAD")
  assert.notEqual(noTags.status, 0)
  assert.match(noTags.stderr, /No stable/)
  assert.equal(repo.read(), content)
})

test("tag refuses an impossible date in a manually prepared entry", (t) => {
  const repo = fixture(t)
  repo.write(initial.replace("## October", `${entry.replace("Unreleased", "February 30, 2026 `v0.10.1`")}## October`))
  const release = repo.commit()
  repo.git("update-ref", "refs/remotes/origin/main", release)
  assert.notEqual(repo.run("tag", "--commit", release).status, 0)
  assert.equal(repo.git("tag", "--list", "v0.10.1"), "")
})
