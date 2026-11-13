// Turns measure/collect.mjs's results into the numbers the cut is judged by.
//
//   node measure/report.mjs <results.json> [cut.json]
//
// cut.json lists tests proposed for deletion: [{ file, title }], where title
// is the start of the test's full title (or "*" for the whole file). With it,
// the report says for each planted bug whether a test outside the cut still
// catches it.
import { readFileSync } from "node:fs";

const [resultsPath, cutPath] = process.argv.slice(2);
const { cells, tests } = JSON.parse(readFileSync(resultsPath, "utf8"));
const mutants = JSON.parse(readFileSync(new URL("./mutants.json", import.meta.url), "utf8"));
const cut = cutPath ? JSON.parse(readFileSync(cutPath, "utf8")) : [];

const baseCells = Object.keys(cells).filter((cell) => cell.startsWith("base-")).sort();
const mutantCells = Object.keys(cells).filter((cell) => !cell.startsWith("base-")).sort();
const inCut = (test) => cut.some((entry) => test.file === entry.file && (entry.title === "*" || test.title.includes(entry.title)));
const layers = ["unit", "integration", "browser"];
const line = (text = "") => console.log(text);

// 1. Size and time, from the baseline cells.
line(`# Baseline: ${baseCells.length} runs of unchanged code`);
for (const layer of layers) {
  const mine = tests.filter((test) => test.layer === layer);
  const perRun = baseCells.map((cell) => mine.reduce((sum, test) => sum + (test.cells[cell]?.ms ?? 0), 0) / 1000);
  const mean = perRun.reduce((a, b) => a + b, 0) / (perRun.length || 1);
  const files = new Set(mine.map((test) => test.file)).size;
  line(`${layer}: ${mine.length} tests in ${files} files, ${mean.toFixed(0)} s of test time per run (min ${Math.min(...perRun).toFixed(0)}, max ${Math.max(...perRun).toFixed(0)})`);
}

// 2. Jobs that broke before any test ran.
line("\n# Baseline jobs that did not finish cleanly");
let broken = 0;
for (const cell of baseCells) {
  for (const [job, record] of Object.entries(cells[cell].jobs)) {
    const bad = [];
    if (!["0", "missing"].includes(record.db)) bad.push(`database start ${record.db}`);
    if (!["0", "missing"].includes(record.build)) bad.push(`build ${record.build}`);
    if (!record.report) bad.push("no report");
    if (record.run !== "0") bad.push(`exit ${record.run}`);
    if (bad.length) { broken++; line(`${cell} ${job}: ${bad.join(", ")}`); }
  }
}
if (!broken) line("none");

// 3. Flaky on unchanged code: failed, or passed only on a retry, in any run.
line("\n# Tests that failed or needed a retry on unchanged code");
const flaky = tests
  .map((test) => ({ test, failed: baseCells.filter((cell) => test.cells[cell]?.r === "f").length, retried: baseCells.filter((cell) => test.cells[cell]?.r === "r").length, missing: baseCells.filter((cell) => !test.cells[cell] || test.cells[cell].r === "s").length }))
  .filter((entry) => entry.failed || entry.retried)
  .sort((a, b) => b.failed + b.retried - (a.failed + a.retried));
for (const { test, failed, retried } of flaky) line(`${failed} failed, ${retried} retried of ${baseCells.length} | ${test.layer} | ${test.file} | ${test.title.slice(0, 140)}${inCut(test) ? " [in cut]" : ""}`);
if (!flaky.length) line("none");
const unstable = new Set(flaky.map(({ test }) => `${test.layer}|${test.file}|${test.title}`));
const runsWithRed = baseCells.filter((cell) => tests.some((test) => test.cells[cell]?.r === "f")).length;
line(`Runs with at least one failed test: ${runsWithRed} of ${baseCells.length}`);

// 4. The slowest files.
line("\n# Slowest 15 files (seconds per run)");
const byFile = new Map();
for (const test of tests) {
  const mean = baseCells.reduce((sum, cell) => sum + (test.cells[cell]?.ms ?? 0), 0) / 1000 / (baseCells.length || 1);
  const key = `${test.layer} ${test.file}`;
  byFile.set(key, (byFile.get(key) ?? 0) + mean);
}
for (const [file, seconds] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 15)) line(`${seconds.toFixed(1)} ${file}`);

// 5. Planted bugs.
line("\n# Planted bugs");
const summary = { caught: 0, missed: 0, onlyCut: 0 };
const killers = new Map();
for (const cell of mutantCells) {
  const mutant = mutants.find((entry) => entry.id === cell) ?? { what: "?", area: "?" };
  const jobs = cells[cell].jobs;
  const typecheck = jobs.unit?.typecheck;
  const lint = jobs.unit?.lint;
  const setup = Object.entries(jobs).filter(([, record]) => !["0", "missing"].includes(record.db) || !["0", "missing"].includes(record.build)).map(([job]) => job);
  const kills = tests.filter((test) => test.cells[cell]?.r === "f" && !unstable.has(`${test.layer}|${test.file}|${test.title}`));
  for (const test of kills) killers.set(test, (killers.get(test) ?? 0) + 1);
  const per = Object.fromEntries(layers.map((layer) => [layer, kills.filter((test) => test.layer === layer)]));
  const kept = kills.filter((test) => !inCut(test));
  const staticCatch = (typecheck && typecheck !== "0" ? ["typecheck"] : []).concat(lint && lint !== "0" ? ["lint"] : []);
  const caught = kills.length > 0 || staticCatch.length > 0 || setup.length > 0;
  const stillCaught = kept.length > 0 || staticCatch.length > 0 || setup.length > 0;
  summary[caught ? "caught" : "missed"]++;
  if (caught && !stillCaught) summary.onlyCut++;
  line(`\n${cell} [${mutant.area}] ${mutant.what}`);
  line(`  ${caught ? "CAUGHT" : "MISSED"}: unit ${per.unit.length}, integration ${per.integration.length}, browser ${per.browser.length}${staticCatch.length ? `, ${staticCatch.join(" and ")}` : ""}${setup.length ? `, setup broke in ${setup.length} jobs` : ""}${cut.length ? ` | after the cut: ${stillCaught ? `still caught by ${kept.length}` : "NOT CAUGHT"}` : ""}`);
  for (const layer of layers) for (const test of per[layer].slice(0, 3)) line(`    ${layer}: ${test.file} › ${test.title.slice(0, 110)}${inCut(test) ? " [in cut]" : ""}`);
}
line(`\nCaught ${summary.caught} of ${mutantCells.length}, missed ${summary.missed}${cut.length ? `, caught only by tests in the cut ${summary.onlyCut}` : ""}`);

// 6. How much of the suite caught anything.
line("\n# Share of each layer that caught at least one planted bug");
for (const layer of layers) {
  const mine = tests.filter((test) => test.layer === layer);
  line(`${layer}: ${mine.filter((test) => killers.has(test)).length} of ${mine.length}`);
}
if (cut.length) {
  const cutTests = tests.filter(inCut);
  const seconds = cutTests.reduce((sum, test) => sum + baseCells.reduce((s, cell) => s + (test.cells[cell]?.ms ?? 0), 0) / 1000 / (baseCells.length || 1), 0);
  line(`\n# The cut: ${cutTests.length} tests, ${seconds.toFixed(0)} s per run, ${cutTests.filter((test) => unstable.has(`${test.layer}|${test.file}|${test.title}`)).length} of them flaky on unchanged code, ${cutTests.filter((test) => killers.has(test)).length} caught a planted bug`);
}
