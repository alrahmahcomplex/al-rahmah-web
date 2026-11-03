import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
