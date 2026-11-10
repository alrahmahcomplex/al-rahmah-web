// Measures CI run time from the GitHub API through `gh`. Read-only: it never
// starts, re-runs or cancels a run. docs/ci/REPORT.md lists the commands.
//
//   node scripts/ci-measure.mjs fetch --event pull_request --out docs/ci/data/x.json
//   node scripts/ci-measure.mjs summary docs/ci/data/x.json [more.json ...]
//   node scripts/ci-measure.mjs summary --json docs/ci/data/x.json
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const WORKFLOW = "ci.yml";

export const seconds = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 1000);

// Median: the middle value, or the mean of the two middle values.
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Nearest-rank percentile: the smallest value with at least p% of the sample
// at or below it.
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const ran = (job) => job.conclusion !== "skipped" && job.started_at && job.completed_at;

// Seconds between `from` and `to` during which no job was running.
function idleSeconds(from, to, jobs) {
  let idle = 0;
  let cursor = Date.parse(from);
  const intervals = jobs.map((job) => [Date.parse(job.started_at), Date.parse(job.completed_at)]).sort((a, b) => a[0] - b[0]);
  for (const [start, end] of intervals) {
    if (start > cursor) idle += start - cursor;
    cursor = Math.max(cursor, end);
  }
  return Math.round((idle + Math.max(0, Date.parse(to) - cursor)) / 1000);
}

// One run's numbers. Run time ends at the last job's completion: the run's own
// `updated_at` can move later for reasons unrelated to the work.
export function runTimes(run) {
  const jobs = run.jobs.filter(ran);
  if (!jobs.length) return null;
  const finished = jobs.map((job) => job.completed_at).sort().at(-1);
  return {
    runSeconds: seconds(run.run_started_at, finished),
    // Queue time: the part of the run time when no job was running. The run
    // was waiting for GitHub to create a job or for a runner to pick one up.
    queueSeconds: idleSeconds(run.run_started_at, finished, jobs),
    // Runner time: the sum of every job's own duration.
    jobSeconds: jobs.reduce((sum, job) => sum + seconds(job.started_at, job.completed_at), 0),
    // The documents-only path runs the scope job, the gate and, since the
    // helper tests moved out of the scope job, the repository job. The full
    // suite ran four jobs before this work and runs more now.
    fullSuite: jobs.length > 3,
  };
}

export function distribution(values) {
  if (!values.length) return null;
  return { n: values.length, median: median(values), p90: percentile(values, 90), min: Math.min(...values), max: Math.max(...values) };
}

export function summarize(runs) {
  const timed = runs.map((run) => ({ run, times: runTimes(run) })).filter(({ times }) => times);
  const group = (rows) => rows.length ? {
    runs: rows.length,
    from: rows.map(({ run }) => run.created_at).sort()[0],
    to: rows.map(({ run }) => run.created_at).sort().at(-1),
    runSeconds: distribution(rows.map(({ times }) => times.runSeconds)),
    queueSeconds: distribution(rows.map(({ times }) => times.queueSeconds)),
    jobSeconds: distribution(rows.map(({ times }) => times.jobSeconds)),
    rerun: rows.filter(({ run }) => run.attempt > 1).length,
  } : null;
  const named = (rows, pick) => {
    const byName = new Map();
    for (const { run } of rows) {
      for (const job of run.jobs.filter(ran)) {
        for (const [name, value] of pick(job)) byName.set(name, [...(byName.get(name) ?? []), value]);
      }
    }
    return Object.fromEntries([...byName].map(([name, values]) => [name, distribution(values)]));
  };
  const full = timed.filter(({ times }) => times.fullSuite);
  return {
    all: group(timed),
    fullSuite: group(full),
    documentsOnly: group(timed.filter(({ times }) => !times.fullSuite)),
    jobs: named(full, (job) => [[job.name, seconds(job.started_at, job.completed_at)]]),
    steps: named(full, (job) => job.steps
      .filter((step) => step.conclusion !== "skipped" && step.started_at && step.completed_at)
      // Shards share their steps: "End-to-end tests (2/4)" counts with "(1/4)".
      .map((step) => [`${job.name.replace(/ \(\d+\/\d+\)$/, "")} / ${step.name}`, seconds(step.started_at, step.completed_at)])),
  };
}

// Every completed run of the window, cancelled ones apart: how many failed,
// and how many needed a second attempt.
export function windowRates(window) {
  const finished = window.filter((run) => ["success", "failure"].includes(run.conclusion));
  const rerun = finished.filter((run) => run.attempt > 1).length;
  return {
    completed: window.length,
    cancelled: window.filter((run) => run.conclusion === "cancelled").length,
    finished: finished.length,
    failed: finished.filter((run) => run.conclusion === "failure").length,
    rerun,
    rerunRate: finished.length ? rerun / finished.length : null,
  };
}

function gh(path, params = {}) {
  const args = ["api", "-X", "GET", path, "-H", "X-GitHub-Api-Version: 2022-11-28"];
  for (const [name, value] of Object.entries(params)) args.push("-f", `${name}=${value}`);
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
}

function listRuns(params, limit) {
  const runs = [];
  for (let page = 1; runs.length < limit; page += 1) {
    const batch = gh(`repos/{owner}/{repo}/actions/workflows/${WORKFLOW}/runs`, { ...params, per_page: 100, page }).workflow_runs;
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  return runs.slice(0, limit);
}

function attemptRecord(runId, attempt) {
  const run = gh(`repos/{owner}/{repo}/actions/runs/${runId}/attempts/${attempt}`);
  const { jobs } = gh(`repos/{owner}/{repo}/actions/runs/${runId}/attempts/${attempt}/jobs`, { per_page: 100 });
  return {
    id: run.id, attempt: run.run_attempt, event: run.event, branch: run.head_branch, sha: run.head_sha,
    title: run.display_title, conclusion: run.conclusion, url: run.html_url,
    created_at: run.created_at, run_started_at: run.run_started_at, updated_at: run.updated_at,
    jobs: jobs.map((job) => ({
      id: job.id, name: job.name, conclusion: job.conclusion, runner: job.runner_name, labels: job.labels,
      created_at: job.created_at, started_at: job.started_at, completed_at: job.completed_at,
      steps: (job.steps ?? []).map((step) => ({
        name: step.name, conclusion: step.conclusion, started_at: step.started_at, completed_at: step.completed_at,
      })),
    })),
  };
}

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith("--") || argv[index + 1] === undefined) throw new Error(`Bad option: ${argv[index]}`);
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

// --event <name> [--branch <name>] [--sha <sha>] [--limit 30] [--attempts latest|all] --out <file>
// `latest` keeps the last successful runs, as `gh run list --status success`
// lists them. `all` keeps every successful attempt of those runs, for a commit
// measured by re-running its run.
function fetch(argv) {
  const { event, branch, sha, out, limit = "30", attempts = "latest" } = options(argv);
  if (!event || !out) throw new Error("fetch needs --event and --out");
  const query = { event, ...(branch && { branch }), ...(sha && { head_sha: sha }) };
  const successful = listRuns({ ...query, status: "success" }, Number(limit));
  const runs = [];
  for (const run of successful) {
    const wanted = attempts === "all" ? Array.from({ length: run.run_attempt }, (_, index) => index + 1) : [run.run_attempt];
    for (const attempt of wanted) {
      const record = attemptRecord(run.id, attempt);
      if (record.conclusion === "success") runs.push(record);
    }
  }
  // Every completed run since the oldest sample: the base for the re-run rate.
  const oldest = successful.map((run) => run.created_at).sort()[0];
  const window = oldest ? listRuns({ ...query, status: "completed", created: `>=${oldest}` }, 1000)
    .map((run) => ({ id: run.id, attempt: run.run_attempt, conclusion: run.conclusion, created_at: run.created_at, sha: run.head_sha })) : [];
  mkdirSync(dirname(out), { recursive: true });
  const lines = (rows) => rows.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  writeFileSync(out, `{\n  "fetched_at": ${JSON.stringify(new Date().toISOString())},\n  "query": ${JSON.stringify({ ...query, limit: Number(limit), attempts })},\n  "runs": [\n${lines(runs)}\n  ],\n  "window": [\n${lines(window)}\n  ]\n}\n`);
  console.log(`Wrote ${runs.length} successful runs and ${window.length} window runs to ${out}`);
}

const cells = (d) => d ? `${d.median} | ${d.p90} | ${d.min} | ${d.max}` : "- | - | - | -";

export function report(file, data) {
  const s = summarize(data.runs);
  const w = windowRates(data.window ?? []);
  const lines = [`### ${file}`, "", `Query ${JSON.stringify(data.query)}, fetched ${data.fetched_at}.`, ""];
  lines.push("| Runs | n | First | Last | Run s median | p90 | min | max | Queue s median | Queue s p90 | Runner s median | Second attempts |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [label, g] of [["All", s.all], ["Full suite", s.fullSuite], ["Documents only", s.documentsOnly]]) {
    if (g) lines.push(`| ${label} | ${g.runs} | ${g.from} | ${g.to} | ${cells(g.runSeconds)} | ${g.queueSeconds.median} | ${g.queueSeconds.p90} | ${g.jobSeconds.median} | ${g.rerun} |`);
  }
  if (!s.all) lines.push("| All | 0 | - | - | not measured | | | | | | | |");
  lines.push("", `Window since the oldest sample: ${w.completed} completed runs, ${w.cancelled} cancelled, ${w.finished} finished, ${w.failed} failed, ${w.rerun} with a second attempt` +
    `${w.rerunRate === null ? "" : ` (re-run rate ${(100 * w.rerunRate).toFixed(1)}%)`}.`, "");
  if (Object.keys(s.jobs).length) {
    lines.push("| Job or step (full-suite runs) | n | median s | p90 s | min | max |", "|---|---|---|---|---|---|");
    for (const [name, d] of Object.entries(s.jobs)) lines.push(`| **${name}** | ${d.n} | ${cells(d)} |`);
    for (const [name, d] of Object.entries(s.steps)) if (d.p90 >= 3) lines.push(`| ${name} | ${d.n} | ${cells(d)} |`);
    lines.push("", "Steps with a p90 under 3 s are left out.", "");
  }
  return lines.join("\n");
}

function summary(argv) {
  const json = argv[0] === "--json";
  for (const file of json ? argv.slice(1) : argv) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    console.log(json ? JSON.stringify({ file, query: data.query, ...summarize(data.runs), window: windowRates(data.window ?? []) }, null, 2) : report(file, data));
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "fetch") fetch(rest);
  else if (command === "summary" && rest.length) summary(rest);
  else throw new Error("Usage: ci-measure.mjs fetch --event <event> --out <file> | summary [--json] <file>...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
