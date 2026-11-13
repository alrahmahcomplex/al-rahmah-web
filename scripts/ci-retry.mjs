// Runs after every finished CI run (.github/workflows/ci-retry.yml).
//
// - A run that failed only because integration tests collided in the shared
//   database is re-run once, and the collision is written into an issue, so
//   it is fixed instead of retried for ever.
// - A failed nightly run opens an issue, so someone sees it.
//
// Anything else is left alone: a real failure stays red.
//
//   node scripts/ci-retry.mjs --run <id> --dry-run   (says what it would do)
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { vitestFailures } from "./ci-flaky.mjs";

// Errors that come from two tests holding database locks at the same time, not
// from the code under test. Keep this list short: a pattern here turns a red
// run into a re-run.
// Each is the whole error line Postgres's client prints, nothing more: an
// assertion that merely mentions one of these words is a real failure.
export const COLLISIONS = [
  { name: "deadlock", pattern: /^error: deadlock detected$/ },
  { name: "lock timeout", pattern: /^error: canceling statement due to lock timeout$/ },
  { name: "fee snapshot", pattern: /^error: fee_snapshot_changed$/ },
];

const strip = (text) => text.replace(/\u001b\[[0-9;]*m/g, "").replace(/^﻿/, "");
const lines = (log) => strip(log).split(/\r?\n/).map((line) => line.replace(/^\S+Z /, ""));

// The error annotations of a job log, without the step's closing line.
export function errors(log) {
  return lines(log)
    .map((line) => line.match(/##\[error\](.*)$/)?.[1]?.trim())
    .filter((message) => message && !/^Process completed with exit code \d+\.?$/.test(message));
}

const collision = (message) => COLLISIONS.find(({ pattern }) => pattern.test(message.trim()))?.name;

// Vitest's own account of a failed shard, from its default reporter: the
// "Failed Tests n" section, one block per error, each block naming its tests
// (" FAIL  integration <file> > <test>") and then the error's first line; and
// the summary's "Tests  n failed". Annotations alone are not enough: Vitest
// writes none for an error without a usable stack.
export function vitestReport(log) {
  const all = lines(log);
  const failed = Number(all.map((line) => line.match(/^\s+Tests\s+(\d+) failed\b/)?.[1]).find(Boolean) ?? NaN);
  const other = all.some((line) => /⎯ (Failed Suites|Unhandled Errors?) \d* ?⎯|Unhandled Rejection/.test(line));
  const start = all.findIndex((line) => /⎯ Failed Tests \d+ ⎯/.test(line));
  const blocks = [];
  if (start !== -1) {
    let block = null;
    for (const line of all.slice(start + 1)) {
      if (/^\s+Test Files\s/.test(line)) break;
      const test = line.match(/^\s*FAIL\s+(?:\|?integration\|?\s+)?(tests\/\S+\.test\.tsx?\s+>\s+.+?)\s*$/);
      if (test) {
        if (!block || block.error !== null) { block = { tests: [], error: null }; blocks.push(block); }
        block.tests.push(test[1]);
      } else if (block && block.error === null && line.trim()) {
        block.error = line.trim();
      }
    }
  }
  return { failed, other, blocks };
}

// failedJobs: [{ name, log }]. Returns what to do with the run.
export function decide({ event, attempt, failedJobs }) {
  const jobs = failedJobs.filter((job) => job.name !== "CI complete");
  const nightly = event === "schedule";
  const kept = { rerun: false, issue: nightly ? "nightly" : null, collisions: [], tests: [] };
  if (!jobs.length) return { ...kept, reason: "no failed job besides the gate" };
  const found = new Set();
  const tests = new Set();
  for (const job of jobs) {
    if (!/^Integration tests\b/.test(job.name)) return { ...kept, reason: `${job.name} failed` };
    const messages = errors(job.log);
    if (!messages.length) return { ...kept, reason: `${job.name} failed with no test error` };
    const other = messages.find((message) => !collision(message));
    if (other) return { ...kept, reason: `${job.name}: ${other.slice(0, 120)}` };
    // Every failed test must be accounted for by a collision, not just the
    // annotated ones.
    const report = vitestReport(job.log);
    if (report.other) return { ...kept, reason: `${job.name}: a suite or unhandled error failed` };
    const named = report.blocks.flatMap((block) => block.tests);
    if (!Number.isInteger(report.failed) || report.failed < 1 || named.length !== report.failed) {
      return { ...kept, reason: `${job.name}: ${report.failed} failed tests, ${named.length} accounted for` };
    }
    const unmatched = report.blocks.find((block) => !block.error || !collision(block.error));
    if (unmatched) return { ...kept, reason: `${job.name}: ${String(unmatched.error).slice(0, 120)}` };
    for (const block of report.blocks) found.add(collision(block.error));
    for (const test of named) tests.add(test);
  }
  const result = { collisions: [...found], tests: [...tests], issue: nightly ? "nightly" : "collision" };
  // A nightly run is reported, not retried. A retried run that collides again
  // is reported again, not retried again.
  if (nightly) return { ...result, rerun: false, reason: "nightly run" };
  if (attempt > 1) return { ...result, rerun: false, reason: `attempt ${attempt} already a re-run` };
  return { ...result, rerun: true, reason: "only database collisions" };
}

// One issue per test file, so the same collision gathers its runs in one place.
export function collisionTitle(tests) {
  const files = [...new Set(tests.map((test) => test.split(" > ")[0].replace(/^tests\/integration\//, "")))].sort();
  return `Tests collide in the database: ${files.length ? files.join(", ") : "unknown test"}`;
}

function gh(args, raw = false) {
  const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return raw ? out : JSON.parse(out);
}

// Open issues with this exact title, oldest first. Read from the issues API,
// not search, which lags behind a new issue.
function openIssues(title) {
  const issues = gh(["api", "--paginate", "--slurp", "-X", "GET", "repos/{owner}/{repo}/issues", "-f", "state=open", "-f", "labels=bug", "-f", "per_page=100"]).flat();
  return issues.filter((issue) => !issue.pull_request && issue.title === title).map((issue) => issue.number).sort((a, b) => a - b);
}

// Two runs that collide at the same time can both find no issue and both open
// one. After opening, each run looks again: if an older issue has the title,
// its own one is the duplicate, and it moves its report there. Each run closes
// only the issue it opened, so the oldest always stays.
export function duplicateOf(created, numbers) {
  const oldest = Math.min(...numbers, created);
  return oldest === created ? null : oldest;
}

function fileOrComment(title, body, dryRun) {
  const [open] = openIssues(title);
  if (dryRun) { console.log(open ? `would comment on #${open}` : `would open "${title}"`); return; }
  if (open) { gh(["issue", "comment", String(open), "--body", body], true); return; }
  const url = gh(["issue", "create", "--title", title, "--label", "bug", "--label", "needs-triage", "--body", body], true).trim();
  const created = Number(url.match(/\/issues\/(\d+)$/)?.[1]);
  if (!created) return;
  const keep = duplicateOf(created, openIssues(title));
  if (keep) {
    gh(["issue", "comment", String(keep), "--body", body], true);
    gh(["issue", "close", String(created), "--reason", "not planned", "--comment", `Duplicate of #${keep}, opened at the same moment by another run.`], true);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const option = (name) => { const index = argv.indexOf(`--${name}`); return index === -1 ? undefined : argv[index + 1]; };
  const dryRun = argv.includes("--dry-run");
  const id = option("run") ?? process.env.RUN_ID;
  if (!id) throw new Error("ci-retry.mjs needs --run <id> or RUN_ID");
  const run = gh(["api", `repos/{owner}/{repo}/actions/runs/${id}`]);
  if (run.conclusion !== "failure") { console.log(`Run ${id} is ${run.conclusion}; nothing to do.`); return; }
  const { jobs } = gh(["api", "-X", "GET", `repos/{owner}/{repo}/actions/runs/${id}/attempts/${run.run_attempt}/jobs`, "-f", "per_page=100"]);
  const failedJobs = jobs.filter((job) => job.conclusion === "failure").map((job) => {
    let log = "";
    try { log = gh(["api", "--allow-escape-sequences", `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`], true); } catch { /* an unreadable log counts as a real failure */ }
    return { name: job.name, log };
  });
  const decision = decide({ event: run.event, attempt: run.run_attempt, failedJobs });
  console.log(`Run ${id} attempt ${run.run_attempt} (${run.event}, ${run.head_branch}): ${decision.rerun ? "re-run" : "leave"}, ${decision.reason}.`);
  for (const test of decision.tests) console.log(`  ${test}`);

  const link = `[run ${id}, attempt ${run.run_attempt}](${run.html_url}/attempts/${run.run_attempt})`;
  if (decision.issue === "nightly") {
    const what = decision.collisions.length ? `Only database collisions (${decision.collisions.join(", ")}).` : `${decision.reason}.`;
    fileOrComment(`Nightly CI failed on ${run.created_at.slice(0, 10)}`, `The nightly run failed: ${link}.\n\n${what}\n\nThe nightly run is main's full suite with no cache, plus the tests tagged \`@nightly\` (the axe scans). Find the failing job, fix it or file what broke, then close this issue.`, dryRun);
  } else if (decision.issue === "collision") {
    const tests = decision.tests.map((test) => `- \`${test}\``).join("\n") || "- (no test name in the log)";
    const next = decision.rerun ? "The failed jobs were re-run once." : "It had already been re-run once, so it stays red.";
    fileOrComment(collisionTitle(decision.tests), `${link} on \`${run.head_branch}\` failed only on a database collision between tests (${decision.collisions.join(", ")}):\n\n${tests}\n\n${next} Two tests hold locks on the same rows or tables at the same time. Fix the tests so they stop sharing locks; see \`docs/agents/workflow.md\` → Checks.`, dryRun);
  }
  if (decision.rerun) {
    if (dryRun) console.log("would re-run the failed jobs");
    else gh(["api", "-X", "POST", `repos/{owner}/{repo}/actions/runs/${id}/rerun-failed-jobs`], true);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
