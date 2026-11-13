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
export const COLLISIONS = [
  { name: "deadlock", pattern: /\bdeadlock detected\b/ },
  { name: "lock timeout", pattern: /\bcanceling statement due to lock timeout\b/ },
  { name: "fee snapshot", pattern: /\bfee_snapshot_changed\b/ },
];

const strip = (text) => text.replace(/\u001b\[[0-9;]*m/g, "").replace(/^﻿/, "");

// The error annotations of a job log, without the step's closing line.
export function errors(log) {
  return strip(log).split(/\r?\n/)
    .map((line) => line.match(/##\[error\](.*)$/)?.[1]?.trim())
    .filter((message) => message && !/^Process completed with exit code \d+\.?$/.test(message));
}

const collision = (message) => COLLISIONS.find(({ pattern }) => pattern.test(message))?.name;

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
    for (const message of messages) found.add(collision(message));
    for (const test of vitestFailures(job.log)) tests.add(test);
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

function fileOrComment(title, body, dryRun) {
  const open = gh(["issue", "list", "--state", "open", "--search", `in:title "${title.replace(/"/g, "")}"`, "--json", "number,title"])
    .find((issue) => issue.title === title);
  if (dryRun) { console.log(open ? `would comment on #${open.number}` : `would open "${title}"`); return; }
  if (open) gh(["issue", "comment", String(open.number), "--body", body], true);
  else gh(["issue", "create", "--title", title, "--label", "bug", "--label", "needs-triage", "--body", body], true);
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
