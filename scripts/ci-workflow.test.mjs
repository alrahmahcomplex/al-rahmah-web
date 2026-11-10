import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The safety rules of .github/workflows/ci.yml, checked on the text of the
// file: this test runs in the scope job, before any dependency is installed.
const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const lines = workflow.split("\n");

function jobBlocks() {
  const start = lines.indexOf("jobs:");
  assert.notEqual(start, -1, "jobs: not found");
  const blocks = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const name = line.match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
    if (name) { current = name[1]; blocks.set(current, []); } else if (current) blocks.get(current).push(line);
  }
  return blocks;
}

const jobs = jobBlocks();
const uncommented = (block) => block.filter((line) => !/^\s*#/.test(line)).join("\n");

test("every action is pinned to a full commit SHA", () => {
  const uses = lines.map((line) => line.match(/^\s*(?:- )?uses:\s*(\S+)/)?.[1]).filter(Boolean);
  assert.ok(uses.length > 0);
  for (const action of uses) assert.match(action, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, action);
});

test("the workflow token can only read the repository", () => {
  const permissions = lines.flatMap((line, index) => (/^\s*permissions:/.test(line) ? [index] : []));
  assert.deepEqual(permissions.map((index) => lines[index]), ["permissions:"]);
  assert.equal(lines[permissions[0] + 1], "  contents: read");
  assert.doesNotMatch(lines[permissions[0] + 2], /^\s+\S/, "contents: read must be the only permission");
});

test("only the caches job can save to the Actions cache", () => {
  assert.ok(lines.includes("cache-mode: read"), "the workflow default must be cache-mode: read");
  assert.ok(jobs.has("caches"));
  for (const [name, block] of jobs) {
    const text = uncommented(block);
    if (name === "caches") {
      assert.match(text, /^ {4}cache-mode: write$/m);
      continue;
    }
    assert.doesNotMatch(text, /cache-mode:/, `${name} must not set its own cache-mode`);
    assert.doesNotMatch(text, /actions\/cache\/save@|actions\/cache@/, `${name} must only restore`);
    assert.doesNotMatch(text, /^\s+cache:/m, `${name} must not let a setup action save a cache`);
  }
});

test("the nightly and the manual run restore no cache", () => {
  assert.match(workflow, /^ {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \*"$/m, "the nightly run is missing");
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);
  const onlyOnPullRequestsAndPushes = "if: ${{ github.event_name == 'pull_request' || github.event_name == 'push' }}";
  let restores = 0;
  for (const [name, block] of jobs) {
    if (name === "caches") continue;
    block.forEach((line, index) => {
      if (!/uses: actions\/cache\/restore@/.test(line)) return;
      restores += 1;
      assert.equal(block[index - 1].trim(), onlyOnPullRequestsAndPushes, `${name} restores a cache in a scheduled run`);
    });
  }
  assert.ok(restores > 0);
});

test("the integration shards are numbered 1 to n and each runs its share of n", () => {
  const text = uncommented(jobs.get("integration"));
  const shards = text.match(/^ {8}shard: \[([\d, ]+)\]$/m)[1].split(",").map((value) => Number(value.trim()));
  assert.deepEqual(shards, Array.from({ length: shards.length }, (_, index) => index + 1));
  // Vitest gives each file to one shard of the total. The total is the
  // matrix's own size, so no shard can be left without a job.
  assert.ok(text.includes("npm run test:integration -- --shard=${{ matrix.shard }}/${{ strategy.job-total }} "));
});

test("the documents-only path skips every runtime job, and the gate always runs", () => {
  for (const [name, block] of jobs) {
    const text = uncommented(block);
    if (name === "scope") continue;
    if (name === "complete") { assert.match(text, /^ {4}if: \$\{\{ always\(\) \}\}$/m); continue; }
    if (name === "repository") {
      // The helper tests and the document checks run for every change.
      assert.doesNotMatch(text, /^ {4}(if|needs):/m, "repository must run for every change, waiting for nothing");
      continue;
    }
    assert.match(text, /^ {4}needs: scope$/m, `${name} must wait for the scope job`);
    assert.match(text, /^ {4}if: \$\{\{ needs\.scope\.outputs\.full_suite == 'true'/m, `${name} must run only for the full suite`);
  }
  assert.doesNotMatch(workflow, /^\s+paths(-ignore)?:/m, "the workflow must stay unfiltered by file paths");
});
