// Lists the tests that failed or were flaky in recent CI runs, from the job
// logs. Read-only. docs/ci/REPORT.md lists the command.
//
//   node scripts/ci-flaky.mjs --limit 100 --out docs/ci/data/flaky.json
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
  const runs = gh(["api", "-X", "GET", "repos/{owner}/{repo}/actions/workflows/ci.yml/runs", "-f", "status=completed", "-f", `per_page=${Math.min(limit, 100)}`]).workflow_runs
    .filter((run) => ["success", "failure"].includes(run.conclusion));
  const records = [];
  for (const run of runs) {
    for (let attempt = 1; attempt <= run.run_attempt; attempt += 1) {
      const { jobs } = gh(["api", "-X", "GET", `repos/{owner}/{repo}/actions/runs/${run.id}/attempts/${attempt}/jobs`, "-f", "per_page=100"]);
      for (const job of jobs.filter((entry) => ["success", "failure"].includes(entry.conclusion) && !/^(Scope|CI complete)/.test(entry.name))) {
        let log;
        try { log = gh(["api", "--allow-escape-sequences", `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`], true); } catch { continue; }
        const playwright = playwrightOutcomes(log);
        const vitest = vitestFailures(log);
        const failedStep = (job.steps ?? []).find((step) => step.conclusion === "failure")?.name ?? null;
        if (job.conclusion === "failure" || playwright.flaky.length || playwright.failed.length || vitest.length) {
          records.push({
            run: run.id, attempt, attempts: run.run_attempt, event: run.event, branch: run.head_branch, sha: run.head_sha.slice(0, 7),
            created_at: run.created_at, job: job.name, conclusion: job.conclusion, failedStep, flaky: playwright.flaky, failed: playwright.failed, vitestFailed: vitest,
          });
        }
      }
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  const scanned = { runs: runs.length, from: runs.at(-1)?.created_at, to: runs[0]?.created_at };
  writeFileSync(out, `{\n  "fetched_at": ${JSON.stringify(new Date().toISOString())},\n  "scanned": ${JSON.stringify(scanned)},\n  "records": [\n${records.map((record) => `    ${JSON.stringify(record)}`).join(",\n")}\n  ]\n}\n`);
  const count = (pick) => {
    const tally = new Map();
    for (const record of records) for (const test of pick(record)) tally.set(test, (tally.get(test) ?? 0) + 1);
    return [...tally].sort((a, b) => b[1] - a[1]);
  };
  console.log(`Scanned ${runs.length} finished runs from ${scanned.from} to ${scanned.to}; ${records.length} jobs had a failure or a flaky test.`);
  console.log("\nPassed on a retry in the same job (flaky):");
  for (const [test, times] of count((record) => record.flaky)) console.log(`  ${times}x ${test}`);
  console.log("\nFailed after every retry (Playwright):");
  for (const [test, times] of count((record) => record.failed)) console.log(`  ${times}x ${test}`);
  console.log("\nFailed (Vitest):");
  for (const [test, times] of count((record) => record.vitestFailed)) console.log(`  ${times}x ${test}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
