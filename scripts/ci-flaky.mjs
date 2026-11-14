// Lists the tests that failed or were flaky in recent CI runs, from the job
// logs. Read-only.
//
//   node scripts/ci-flaky.mjs --limit 100 --out <file>.json
//
// A Playwright test is "flaky" when it failed and then passed on a retry in
// the same job. A test that fails in one attempt of a run and passes in a
// later attempt of the same commit is flaky across attempts.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const strip = (text) => text.replace(/\u001b\[[0-9;]*m/g, "").replace(/^﻿/, "");
const body = (line) => line.replace(/^\S+Z /, "");

// Playwright ends with a summary: "  2 failed", then one indented line per
// test, then "  1 flaky" and its tests, then "  376 passed (22.2m)".
export function playwrightOutcomes(log) {
  const outcomes = { failed: [], flaky: [] };
  let section = null;
  for (const line of strip(log).split(/\r?\n/).map(body)) {
    const head = line.match(/^ {2}(\d+) (failed|flaky|passed|skipped|did not run|interrupted)\b/);
    if (head) { section = outcomes[head[2]] ?? null; continue; }
    const test = section && line.match(/^ {4}(\[[\w-]+\] › .+?)\s*$/);
    if (test) section.push(test[1].replace(/:\d+:\d+ › /, " › "));
    else if (section && line.trim() !== "") section = null;
  }
  return outcomes;
}

// Vitest prints " FAIL  <project> <file> > <test>" for each failed test.
export function vitestFailures(log) {
  const failures = new Set();
  for (const line of strip(log).split(/\r?\n/).map(body)) {
    const match = line.match(/^\s*(?:FAIL|×)\s+(?:\|?(unit|integration)\|?\s+)?(tests\/\S+\.test\.tsx?)\s+>\s+(.+?)(?:\s+\d+ms)?\s*$/);
    if (match) failures.add(`${match[2]} > ${match[3]}`);
  }
  return [...failures];
}

// In GitHub Actions, Vitest writes a summary that names each test that passed
// only on a retry, under "##### `<file>` (n flaky tests)". The integration
// step prints that summary into its log.
export function vitestFlaky(log) {
  const flaky = [];
  let file = null;
  for (const line of strip(log).split(/\r?\n/).map(body)) {
    const heading = line.match(/^#{5} `(.+?)` \(\d+ flaky tests?\)\s*$/);
    if (heading) { file = heading[1]; continue; }
    const test = file && line.match(/^- \[?`(.+?)`(?:\]\([^)]*\))? \(\*{0,2}passed on retry \d+ out of \d+\*{0,2}\)\s*$/);
    if (test) flaky.push(`${file} > ${test[1]}`);
    else if (file && line.trim() !== "") file = null;
  }
  return flaky;
}

function gh(args, raw = false) {
  const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return raw ? out : JSON.parse(out);
}

function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const index = argv.indexOf(`--${name}`); return index === -1 ? fallback : argv[index + 1]; };
  const limit = Number(option("limit", "100"));
  const out = option("out");
  if (!out) throw new Error("ci-flaky.mjs needs --out <file>");
  // The API gives 100 runs a page.
  const listed = [];
  for (let page = 1; listed.length < limit; page += 1) {
    const batch = gh(["api", "-X", "GET", "repos/{owner}/{repo}/actions/workflows/ci.yml/runs", "-f", "status=completed", "-f", "per_page=100", "-f", `page=${page}`]).workflow_runs;
    listed.push(...batch);
    if (batch.length < 100) break;
  }
  const runs = listed.slice(0, limit).filter((run) => ["success", "failure"].includes(run.conclusion));
  const records = [];
  // Jobs whose log could not be read: GitHub deletes old logs, and a request
  // can fail. They are named in the output, so a gap is never silent.
  const unreadable = [];
  for (const run of runs) {
    for (let attempt = 1; attempt <= run.run_attempt; attempt += 1) {
      const { jobs } = gh(["api", "-X", "GET", `repos/{owner}/{repo}/actions/runs/${run.id}/attempts/${attempt}/jobs`, "-f", "per_page=100"]);
      for (const job of jobs.filter((entry) => ["success", "failure"].includes(entry.conclusion) && !/^(Scope|CI complete)/.test(entry.name))) {
        let log;
        try { log = gh(["api", "--allow-escape-sequences", `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`], true); } catch {
          unreadable.push({ run: run.id, attempt, job: job.name, conclusion: job.conclusion });
          continue;
        }
        const playwright = playwrightOutcomes(log);
        const vitest = vitestFailures(log);
        const retried = vitestFlaky(log);
        const failedStep = (job.steps ?? []).find((step) => step.conclusion === "failure")?.name ?? null;
        if (job.conclusion === "failure" || playwright.flaky.length || playwright.failed.length || vitest.length || retried.length) {
          records.push({
            run: run.id, attempt, attempts: run.run_attempt, event: run.event, branch: run.head_branch, sha: run.head_sha.slice(0, 7),
            created_at: run.created_at, job: job.name, conclusion: job.conclusion, failedStep, flaky: playwright.flaky, failed: playwright.failed,
            vitestFlaky: retried, vitestFailed: vitest,
          });
        }
      }
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  const scanned = { runs: runs.length, from: runs.at(-1)?.created_at, to: runs[0]?.created_at };
  const rows = (list) => list.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  writeFileSync(out, `{\n  "fetched_at": ${JSON.stringify(new Date().toISOString())},\n  "scanned": ${JSON.stringify(scanned)},\n  "records": [\n${rows(records)}\n  ],\n  "unreadable": [\n${rows(unreadable)}\n  ]\n}\n`);
  const count = (pick) => {
    const tally = new Map();
    for (const record of records) for (const test of pick(record)) tally.set(test, (tally.get(test) ?? 0) + 1);
    return [...tally].sort((a, b) => b[1] - a[1]);
  };
  console.log(`Scanned ${runs.length} finished runs from ${scanned.from} to ${scanned.to}; ${records.length} jobs had a failure or a flaky test.`);
  if (unreadable.length) {
    const failed = unreadable.filter((job) => job.conclusion === "failure").length;
    console.log(`\nNOT SCANNED: ${unreadable.length} job logs could not be read, ${failed} of them of failed jobs. The lists below leave them out; "unreadable" in ${out} names them.`);
  }
  console.log("\nPassed on a retry in the same job (flaky):");
  for (const [test, times] of count((record) => record.flaky)) console.log(`  ${times}x ${test}`);
  console.log("\nFailed after every retry (Playwright):");
  for (const [test, times] of count((record) => record.failed)) console.log(`  ${times}x ${test}`);
  console.log("\nPassed on a retry (Vitest, flaky):");
  for (const [test, times] of count((record) => record.vitestFlaky ?? [])) console.log(`  ${times}x ${test}`);
  console.log("\nFailed (Vitest):");
  for (const [test, times] of count((record) => record.vitestFailed)) console.log(`  ${times}x ${test}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
