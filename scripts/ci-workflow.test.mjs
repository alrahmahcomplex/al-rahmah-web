import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
      // Only a push starts it, and the workflow's one push trigger is main.
      assert.match(text, /^ {4}if: \$\{\{ needs\.scope\.outputs\.full_suite == 'true' && github\.event_name == 'push' \}\}$/m, "caches must run for pushes only");
      assert.match(workflow, /^ {2}push:\n {4}branches: \[main\]$/m, "the push trigger must be main alone");
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

test("every job uses one node_modules cache key, made of everything that decides its contents", () => {
  const keys = lines.filter((line) => /^\s+key: node-modules-/.test(line)).map((line) => line.trim());
  assert.ok(keys.length >= 4, "the restores and the caches job's lookup");
  assert.equal(new Set(keys).size, 1, "the jobs use different cache keys");
  // Without package.json in the key, a pull request that changes it and not
  // the lockfile would restore the old node_modules and skip the `npm ci`
  // that refuses the mismatch.
  for (const part of ["runner.os", "runner.arch", "steps.node.outputs.node-version", "hashFiles('package.json', 'package-lock.json', '.npmrc')"]) {
    assert.ok(keys[0].includes(part), `the cache key lacks ${part}`);
  }
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

// scripts/ci-db-start.sh turns Storage and Realtime off in CI, so their
// schemas are never set up there. While a service is off, no migration, seed,
// app file or test may use it. A change that starts using one removes its
// export from that script, and this test then stops checking it.
const ciStart = readFileSync(new URL("ci-db-start.sh", import.meta.url), "utf8");
const offInCi = (name) => new RegExp(`^export SUPABASE_${name}_ENABLED=false$`, "m").test(ciStart);
const serviceUses = {
  // storage.objects, "storage"."buckets", supabase.storage.from(...),
  // .storage.listBuckets(), the /storage/v1 endpoint.
  STORAGE: /\b"?storage"?\s*\.\s*"?(?:objects|buckets|prefixes|s3_multipart_uploads)\b|\.storage\s*\.\s*(?:from|listBuckets|getBucket|createBucket)\s*\(|\/storage\/v1\b/i,
  // realtime.messages, the supabase_realtime publication, supabase.channel(...),
  // the /realtime/v1 endpoint.
  REALTIME: /\b"?realtime"?\s*\.\s*"?(?:messages|subscription|send|broadcast_changes)\b|publication\s+"?supabase_realtime|\.channel\s*\(|\.removeChannel\s*\(|\/realtime\/v1\b/i,
};

test("services CI turns off are used by nothing", () => {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const files = ["supabase/migrations/*.sql", "supabase/seeds/*.sql", "{app,components,lib,utils,tests,e2e}/**/*.{ts,tsx}"]
    .flatMap((pattern) => globSync(pattern, { cwd }).map((file) => file.split(sep).join("/")));
  assert.ok(files.length > 100, `only ${files.length} files found`);
  const texts = files.map((file) => [file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")]);
  for (const [service, uses] of Object.entries(serviceUses)) {
    if (!offInCi(service)) continue;
    const users = texts.filter(([, text]) => uses.test(text)).map(([file]) => file);
    assert.deepEqual(users, [], `these files use ${service.toLowerCase()}, which CI turns off. Remove "export SUPABASE_${service}_ENABLED=false" from scripts/ci-db-start.sh in the same change.`);
  }
});

test("the service check finds the usual ways of using each service", () => {
  const found = {
    STORAGE: ["insert into storage.buckets (id) values ('a')", 'select * from "storage"."objects"', "supabase.storage\n  .from('a')", "client.storage.listBuckets()", "fetch(`${url}/storage/v1/object`)"],
    REALTIME: ["alter publication supabase_realtime add table leads", "select realtime.send('x')", "supabase\n  .channel('leads')", "fetch(`${url}/realtime/v1/api`)"],
  };
  const missed = ["window.sessionStorage.clear()", "localStorage.getItem('a')", "-- its own live in auth, storage, realtime,", "const realtimeCount = 3"];
  for (const [service, samples] of Object.entries(found)) {
    for (const sample of samples) assert.match(sample, serviceUses[service], `${service} missed: ${sample}`);
    for (const sample of missed) assert.doesNotMatch(sample, serviceUses[service], `${service} flagged: ${sample}`);
  }
});

test("every helper test file runs in some job", () => {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const files = (pattern) => globSync(pattern, { cwd }).map((file) => file.split(sep).join("/"));
  const tested = (text) => [...text.matchAll(/node --test "?([^"\s]+)"?/g)].flatMap(([, pattern]) => files(pattern));
  const ran = new Set(tested(uncommented(lines)));
  const all = files("scripts/*.test.mjs");
  assert.ok(all.length > 1);
  assert.deepEqual(all.filter((file) => !ran.has(file)), []);
  // design-lint needs the typescript package, which only the static job
  // installs; the repository job installs nothing.
  assert.ok(tested(uncommented(jobs.get("static"))).includes("scripts/design-lint.test.mjs"));
  assert.ok(!tested(uncommented(jobs.get("repository"))).includes("scripts/design-lint.test.mjs"));
});
