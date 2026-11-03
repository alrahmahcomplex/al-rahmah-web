import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkDocuments, documentErrors } from "./check-docs.mjs";

function fixture(t) {
  const parent = resolve(tmpdir());
  const cwd = mkdtempSync(join(parent, "alrahmah-doc-check-"));
  t.after(() => {
    if (dirname(resolve(cwd)) !== parent || !cwd.startsWith(join(parent, "alrahmah-doc-check-"))) throw new Error("Unsafe fixture cleanup path");
    rmSync(cwd, { recursive: true, force: true });
  });
  writeFileSync(join(cwd, "AGENTS.md"), "# Instructions\n");
  writeFileSync(join(cwd, "CLAUDE.md"), "@AGENTS.md\n");
  mkdirSync(join(cwd, "docs"));
  writeFileSync(join(cwd, "docs", "guide.md"), "# Guide\n");
  return cwd;
}

test("document links resolve relative to their file and ignore remote URLs and anchors", (t) => {
  const cwd = fixture(t);
  assert.deepEqual(documentErrors("docs/guide.md", "[rules](../AGENTS.md#instructions) [remote](https://example.com/a) [heading](#guide)", cwd), []);
  assert.deepEqual(documentErrors("docs/guide.md", "[rules][ref]\n[ref]: ../AGENTS.md", cwd), []);
  assert.equal(documentErrors("docs/guide.md", "[missing](missing.md)", cwd).length, 1);
});

test("illustrative links in fenced and inline code are not treated as real links", (t) => {
  const cwd = fixture(t);
  assert.deepEqual(documentErrors("docs/guide.md", "```md\n[example](placeholder.md)\n```\n`[example](placeholder.md)`", cwd), []);
});

test("conflict markers fail and removed document paths are safe", (t) => {
  const cwd = fixture(t);
  assert.equal(documentErrors("AGENTS.md", "<<<<<<< HEAD\ntext\n=======\nother\n>>>>>>> branch", cwd).length, 1);
  assert.deepEqual(checkDocuments(["docs/deleted.md"], cwd), []);
});

test("Claude instruction pointer must resolve to the shared agent rules", (t) => {
  const cwd = fixture(t);
  assert.deepEqual(checkDocuments(["AGENTS.md", "CLAUDE.md"], cwd), []);
  writeFileSync(join(cwd, "CLAUDE.md"), "@missing.md\n");
  assert.equal(checkDocuments(["CLAUDE.md"], cwd).length, 1);
});

for (const operation of ["delete", "rename"]) {
  test(`document CLI catches incoming links after a guide ${operation}`, (t) => {
    const cwd = fixture(t);
    const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
    writeFileSync(join(cwd, "README.md"), "[Guide](docs/guide.md)\n");
    git("init");
    git("add", ".");
    if (operation === "delete") unlinkSync(join(cwd, "docs", "guide.md"));
    else renameSync(join(cwd, "docs", "guide.md"), join(cwd, "docs", "renamed.md"));
    git("add", "-A");
    const script = fileURLToPath(new URL("./check-docs.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script], {
      cwd, encoding: "utf8",
      env: { ...process.env, CHANGED_DOCUMENTS: '["docs/guide.md"]' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /README\.md: missing local link target docs\/guide\.md/);
    writeFileSync(join(cwd, "README.md"), operation === "delete" ? "Guide removed.\n" : "[Guide](docs/renamed.md)\n");
    assert.equal(spawnSync(process.execPath, [script], { cwd, encoding: "utf8" }).status, 0);
  });
}
