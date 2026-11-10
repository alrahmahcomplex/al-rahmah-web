// Splits the browser tests into shards of equal measured time, and checks
// that no test is left out. CI runs each shard in its own job.
//
//   node scripts/e2e-shards.mjs run <shard>             run one shard, then check what ran
//   node scripts/e2e-shards.mjs check <list.json>       compare the shards with `playwright test --list --reporter=json`
//   node scripts/e2e-shards.mjs timings <report.json>.. rewrite the measured seconds from Playwright JSON reports
//   node scripts/e2e-shards.mjs plan                    print the shards and their seconds
//
// e2e/shards.json holds the number of shards and each spec file's measured
// seconds. A spec file without a measurement counts as the median file.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TEST_DIR = "e2e";
const CONFIG = `${TEST_DIR}/shards.json`;
// Where playwright.config.ts writes its JSON report in CI. Playwright empties
// test-results/ when a run starts and writes the report when it ends.
export const RESULTS = "test-results/e2e-results.json";

// Playwright's default testMatch. playwright.config.ts sets none of its own
// beyond splitting these files between its two projects.
const isSpec = (path) => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path);

export function specFiles(dir = TEST_DIR) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && isSpec(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`.replace(/\\/g, "/").slice(dir.length + 1))
    .sort();
}

export function readConfig(path = CONFIG) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!Number.isInteger(config.shards) || config.shards < 1) throw new Error(`${path}: "shards" must be a whole number of 1 or more`);
  return { shards: config.shards, seconds: config.seconds ?? {} };
}

// Longest file first, each onto the shard with the least time so far. Every
// file lands in exactly one shard, whatever the measurements say.
export function plan(files, seconds, shards) {
  const known = files.map((file) => seconds[file]).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = (file) => (Number.isFinite(seconds[file]) && seconds[file] > 0 ? seconds[file] : fallback);
  const result = Array.from({ length: shards }, () => ({ files: [], seconds: 0 }));
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const target = result.reduce((least, shard) => (shard.seconds < least.seconds ? shard : least));
    target.files.push(file);
    target.seconds += weight(file);
  }
  for (const shard of result) shard.files.sort();
  return result;
}

// Every test of a Playwright JSON report, with its spec file.
export function reportTests(report) {
  const tests = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const run of spec.tests ?? []) tests.push({ file: spec.file, title: spec.title, project: run.projectName, results: run.results ?? [] });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return tests;
}

// The shards must hold exactly the files Playwright finds tests in.
export function checkErrors(files, shards, listed) {
  const errors = [];
  const planned = shards.flatMap((shard) => shard.files);
  const listedFiles = new Set(listed.map((test) => test.file));
  for (const file of new Set(planned)) {
    if (planned.filter((other) => other === file).length > 1) errors.push(`${file} is in more than one shard`);
    if (!listedFiles.has(file)) errors.push(`${file} is in a shard, but Playwright lists no test in it`);
  }
  for (const file of listedFiles) if (!planned.includes(file)) errors.push(`${file} has tests, but no shard runs it`);
  if (planned.length !== files.length) errors.push(`The shards hold ${planned.length} files, but ${files.length} spec files exist`);
  return errors;
}

// After a shard ran: its report must hold exactly its files, and every test
// in them must have run.
export function verifyErrors(shardFiles, ran) {
  const errors = [];
  const ranFiles = new Set(ran.map((test) => test.file));
  for (const file of shardFiles) if (!ranFiles.has(file)) errors.push(`${file} belongs to this shard, but none of its tests ran`);
  for (const file of ranFiles) if (!shardFiles.includes(file)) errors.push(`${file} ran, but belongs to another shard`);
  for (const test of ran) if (!test.results.length) errors.push(`${test.file}: "${test.title}" [${test.project}] did not run`);
  return errors;
}

// Seconds per spec file: each test's last attempt, summed.
export function fileSeconds(reports) {
  const totals = new Map();
  for (const report of reports) {
    for (const test of reportTests(report)) {
      const last = test.results.at(-1);
      if (last) totals.set(test.file, (totals.get(test.file) ?? 0) + last.duration / 1000);
    }
  }
  return Object.fromEntries([...totals].sort(([a], [b]) => a.localeCompare(b)).map(([file, value]) => [file, Math.round(value * 10) / 10]));
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const fail = (errors) => { throw new Error(errors.join("\n")); };

function shardOf(text, shards) {
  const index = Number(text);
  if (!Number.isInteger(index) || index < 1 || index > shards.length) throw new Error(`Shard must be 1 to ${shards.length}, received ${text}`);
  return shards[index - 1];
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const config = readConfig();
  const files = specFiles();
  const shards = plan(files, config.seconds, config.shards);
  if (command === "plan") {
    shards.forEach((shard, index) => console.log(`${index + 1}/${shards.length}: ${shard.seconds.toFixed(1)} s, ${shard.files.length} files\n  ${shard.files.join("\n  ")}`));
  } else if (command === "check" && rest.length === 1) {
    const errors = checkErrors(files, shards, reportTests(readJson(rest[0])));
    if (errors.length) fail(errors);
    console.log(`${shards.length} shards hold all ${files.length} spec files that Playwright lists.`);
  } else if (command === "run" && rest.length >= 1) {
    const shard = shardOf(rest[0], shards);
    // Playwright reads each argument as a regular expression on the file path.
    const patterns = shard.files.map((file) => `${escape(`${TEST_DIR}/${file}`)}$`);
    // An older report must never stand in for this run's.
    rmSync(RESULTS, { force: true });
    const run = spawnSync("npx", ["playwright", "test", ...patterns, ...rest.slice(1)], { stdio: "inherit", shell: process.platform === "win32" });
    if (!existsSync(RESULTS)) {
      console.error(`Playwright wrote no report to ${RESULTS}, so the shard cannot be checked. It writes one only when CI is set.`);
      process.exitCode = run.status || 1;
      return;
    }
    const errors = verifyErrors(shard.files, reportTests(readJson(RESULTS)));
    if (errors.length) fail(errors);
    console.log(`Shard ${rest[0]}/${shards.length}: all ${shard.files.length} spec files ran.`);
    process.exitCode = run.status ?? 1;
  } else if (command === "timings" && rest.length) {
    const seconds = fileSeconds(rest.map(readJson));
    const missing = files.filter((file) => !(file in seconds));
    if (missing.length) fail(missing.map((file) => `No measurement for ${file}`));
    const lines = Object.entries(seconds).filter(([file]) => files.includes(file)).map(([file, value]) => `    ${JSON.stringify(file)}: ${value}`);
    writeFileSync(CONFIG, `{\n  "shards": ${config.shards},\n  "seconds": {\n${lines.join(",\n")}\n  }\n}\n`);
    console.log(`Wrote the seconds of ${lines.length} spec files to ${CONFIG}.`);
  } else {
    throw new Error("Usage: e2e-shards.mjs run <shard> | check <list.json> | timings <report.json>... | plan");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
