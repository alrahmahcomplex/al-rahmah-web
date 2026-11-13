// Reads the artifacts of the Measure runs and writes one results file.
//
//   gh run download <run> -D <dir>          once per run, into the same <dir>
//   node measure/collect.mjs <dir> <out.json>
//
// <dir> holds one folder per job: m_<cell>_unit, m_<cell>_integration_<n>,
// m_<cell>_browser_<n>. The output lists every test with its result in every
// cell: p passed, f failed, r passed on a retry (flaky), s skipped or not run.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error("Usage: collect.mjs <artifacts dir> <out.json>");

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const status = (path) => read(path)?.trim() ?? "missing";
const short = (file) => file.replace(/\\/g, "/").replace(/^.*\/(tests|e2e)\//, "$1/");

const tests = new Map(); // key -> { layer, file, title, cells: { cell: { r, ms } } }
const cells = {}; // cell -> { jobs: { name: statuses } }
const note = (layer, file, title, cell, r, ms) => {
  const key = `${layer}|${file}|${title}`;
  if (!tests.has(key)) tests.set(key, { layer, file, title, cells: {} });
  const seen = tests.get(key).cells[cell];
  // A test listed twice in one cell (two projects) keeps its worst result.
  const rank = { f: 3, r: 2, s: 1, p: 0 };
  if (!seen || rank[r] > rank[seen.r]) tests.get(key).cells[cell] = { r, ms: Math.round(ms ?? 0) };
};

function vitest(path, layer, cell, retried) {
  const text = read(path);
  if (!text) return false;
  for (const file of JSON.parse(text).testResults) {
    for (const test of file.assertionResults) {
      const name = short(file.name);
      const result = test.status === "passed" ? (retried.has(test.fullName) ? "r" : "p") : test.status === "failed" ? "f" : "s";
      note(layer, name, test.fullName, cell, result, test.duration);
    }
  }
  return true;
}

// The names Vitest's summary gives the tests that passed only on a retry.
function retriedNames(summary) {
  const names = new Set();
  if (!summary) return names;
  const at = summary.search(/flaky/i);
  if (at < 0) return names;
  for (const line of summary.slice(at).split("\n")) {
    const match = line.match(/^\s*[-*]\s+(?:\[[^\]]*\]\([^)]*\)|`[^`]*`|\S+\.test\.ts\S*)?\s*(?:>|›)?\s*(.+?)\s*(?:\((?:passed|retry|retried).*\))?$/);
    if (match) names.add(match[1].replace(/\s+>\s+/g, " ").replace(/\*\*/g, "").trim());
  }
  return names;
}

function playwright(path, cell) {
  const text = read(path);
  if (!text) return false;
  const walk = (suite, trail) => {
    for (const spec of suite.specs ?? []) {
      for (const run of spec.tests ?? []) {
        const results = run.results ?? [];
        const last = results.at(-1);
        const title = [...trail, spec.title].join(" › ");
        let result = "s";
        if (last?.status === "passed") result = results.length > 1 ? "r" : "p";
        else if (last && last.status !== "skipped") result = "f";
        note("browser", `e2e/${spec.file}`, title, cell, result, results.reduce((sum, entry) => sum + (entry.duration ?? 0), 0));
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.title && child.title !== child.file ? [...trail, child.title] : trail);
  };
  for (const suite of JSON.parse(text).suites ?? []) walk(suite, []);
  return true;
}

for (const job of readdirSync(dir).sort()) {
  const match = job.match(/^m_([a-z]+-?\d+)_(unit|integration|browser)(?:_(\d+))?$/);
  if (!match) continue;
  const [, cell, layer, shard] = match;
  const path = `${dir}/${job}`;
  cells[cell] ??= { jobs: {} };
  const record = { db: status(`${path}/db-start.status`), build: status(`${path}/build.status`), typecheck: status(`${path}/typecheck.status`), lint: status(`${path}/lint.status`), run: status(`${path}/${layer}.status`) };
  if (layer === "unit") record.report = vitest(`${path}/unit.json`, "unit", cell, new Set());
  if (layer === "integration") {
    const summary = read(`${path}/summary.md`);
    record.report = vitest(`${path}/integration.json`, "integration", cell, retriedNames(summary));
    record.summaryFlaky = summary ? /flaky/i.test(summary) : false;
  }
  if (layer === "browser") record.report = playwright(`${path}/e2e.json`, cell);
  cells[cell].jobs[shard ? `${layer}_${shard}` : layer] = record;
}

writeFileSync(out, JSON.stringify({ cells, tests: [...tests.values()] }));
console.log(`${Object.keys(cells).length} cells, ${tests.size} tests -> ${out}`);
