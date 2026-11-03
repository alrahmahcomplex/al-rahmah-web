import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { classifyChanges, determineScope, gateErrors, parseNameStatus } from "./ci-scope.mjs";

test("ordinary docs and policy docs use document checks without runtime jobs", () => {
  for (const path of ["README.md", "CHANGELOG.md", "CONTEXT.md", "AGENTS.md", "CLAUDE.md", "docs/agents/workflow.md", "docs/adr/0001.md"]) {
    assert.equal(classifyChanges([{ status: "M", paths: [path] }]).fullSuite, false, path);
  }
});

test("code, schema, dependencies, CI and unfamiliar paths require the full suite", () => {
  for (const path of ["app/page.tsx", "supabase/migrations/20261103000000.sql", "package.json", "package-lock.json", ".github/workflows/ci.yml", "scripts/ci-scope.mjs", "docs/example.ts", "app/README.md", "unknown.md"]) {
    assert.equal(classifyChanges([{ status: "M", paths: [path] }]).fullSuite, true, path);
  }
  assert.equal(classifyChanges([{ status: "M", paths: ["README.md"] }, { status: "M", paths: ["proxy.ts"] }]).fullSuite, true);
});

test("NUL parsing preserves unusual names and both sides of renames", () => {
  const changes = parseNameStatus("R100\0app/old.ts\0docs/new.md\0M\0docs/name with\na tab\t.md\0");
  assert.deepEqual(changes, [
    { status: "R100", paths: ["app/old.ts", "docs/new.md"] },
    { status: "M", paths: ["docs/name with\na tab\t.md"] },
  ]);
  assert.equal(classifyChanges(changes).fullSuite, true);
  assert.equal(classifyChanges(parseNameStatus("R100\0docs/old.md\0docs/new.md\0")).fullSuite, false);
});

test("empty diffs, type changes and malformed records never grant a shortcut", () => {
  assert.equal(classifyChanges([]).fullSuite, true);
  assert.equal(classifyChanges([{ status: "T", paths: ["README.md"] }]).fullSuite, true);
  for (const output of ["M\0README.md", "R100\0README.md\0", "?\0README.md\0"]) {
    assert.throws(() => parseNameStatus(output));
  }
});

test("a runtime change after hundreds of documents is still inspected", () => {
  const docs = Array.from({ length: 350 }, (_, index) => `M\0docs/page-${index}.md\0`).join("");
  const changes = parseNameStatus(`${docs}M\0lib/services/admissions.ts\0`);
  assert.equal(changes.length, 351);
  assert.equal(classifyChanges(changes).fullSuite, true);
});

function fixture(t) {
  const parent = resolve(tmpdir());
  const cwd = mkdtempSync(join(parent, "alrahmah-ci-scope-"));
  t.after(() => {
    if (dirname(resolve(cwd)) !== parent || !cwd.startsWith(join(parent, "alrahmah-ci-scope-"))) throw new Error("Unsafe fixture cleanup path");
    rmSync(cwd, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", ["-c", "user.name=CI scope test", "-c", "user.email=ci@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (path, content) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const commit = () => { git("add", "."); git("commit", "-m", "Fixture"); return git("rev-parse", "HEAD"); };
  git("init", "-b", "main");
  write("README.md", "Initial\n");
  const initial = commit();
  return { cwd, git, write, commit, initial };
}

test("pull requests compare merge-base to head, excluding unrelated base changes", (t) => {
  const repo = fixture(t);
  repo.git("checkout", "-b", "docs");
  repo.write("README.md", "Improved\n");
  const head = repo.commit();
  repo.git("checkout", "main");
  repo.write("app/page.tsx", "base branch code\n");
  const target = repo.commit();
  const result = determineScope({ cwd: repo.cwd, eventName: "pull_request", event: { pull_request: { base: { sha: target }, head: { sha: head } } } });
  assert.equal(result.fullSuite, false);
  assert.equal(result.base, repo.initial);
  assert.equal(result.head, head);
  assert.deepEqual(result.documents, ["README.md"]);
});

test("pushes inspect every commit between before and after", (t) => {
  const repo = fixture(t);
  repo.write("app/page.tsx", "runtime change\n");
  repo.commit();
  repo.write("README.md", "docs followup\n");
  const head = repo.commit();
  assert.equal(determineScope({ cwd: repo.cwd, eventName: "push", event: { before: repo.initial, after: head } }).fullSuite, true);
});

test("renaming code to Markdown still requires runtime checks", (t) => {
  const repo = fixture(t);
  repo.write("source.ts", "export const value = 1;\n");
  const before = repo.commit();
  repo.git("mv", "source.ts", "README.md.bak");
  repo.git("mv", "README.md", "CONTEXT.md");
  repo.git("mv", "README.md.bak", "README.md");
  const after = repo.commit();
  assert.equal(determineScope({ cwd: repo.cwd, eventName: "push", event: { before, after } }).fullSuite, true);
});

test("missing, zero, inaccessible and unsupported comparisons fail safe", (t) => {
  const repo = fixture(t);
  for (const before of [undefined, "0".repeat(40), "f".repeat(40), "--help"]) {
    const result = determineScope({ cwd: repo.cwd, eventName: "push", event: { before, after: repo.initial } });
    assert.equal(result.fullSuite, true);
    assert.equal(result.documents, null);
  }
  assert.equal(determineScope({ cwd: repo.cwd, eventName: "workflow_dispatch", event: {} }).fullSuite, true);
});

function needs(fullSuite, result) {
  return { scope: { result: "success", outputs: { full_suite: fullSuite } }, static: { result }, "database-and-browser": { result } };
}

test("completion gate accepts only the expected successful or skipped jobs", () => {
  assert.deepEqual(gateErrors(needs("true", "success")), []);
  assert.deepEqual(gateErrors(needs("false", "skipped")), []);
  for (const fullSuite of ["true", "false"]) {
    for (const job of ["scope", "static", "database-and-browser"]) {
      for (const result of ["failure", "cancelled"]) {
        const state = needs(fullSuite, fullSuite === "true" ? "success" : "skipped");
        state[job].result = result;
        assert.notEqual(gateErrors(state).length, 0);
      }
    }
  }
  assert.notEqual(gateErrors(needs("true", "skipped")).length, 0);
  assert.notEqual(gateErrors(needs("false", "success")).length, 0);
  assert.notEqual(gateErrors(needs("", "success")).length, 0);
  assert.notEqual(gateErrors({}).length, 0);
});
