import assert from "node:assert/strict";
import test from "node:test";
import { median, percentile, runTimes, summarize, windowRates } from "./ci-measure.mjs";

const at = (second) => new Date(Date.UTC(2026, 10, 10, 8, 0, second)).toISOString();
const job = (name, start, end, steps = []) => ({ name, conclusion: "success", created_at: at(start), started_at: at(start), completed_at: at(end), steps });
const skipped = (name) => ({ name, conclusion: "skipped", created_at: at(0), started_at: at(0), completed_at: at(0), steps: [] });

test("median takes the middle value or the mean of the two middle values", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("p90 is the nearest-rank value, never an interpolation", () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(percentile(Array.from({ length: 30 }, (_, index) => index + 1), 90), 27);
  assert.equal(percentile([7, 3, 5], 90), 7);
  assert.equal(percentile([42], 90), 42);
  assert.equal(percentile([], 90), null);
});

test("run time ends at the last job, and queue time is the time with no job running", () => {
  const run = {
    attempt: 1, created_at: at(0), run_started_at: at(0),
    // 3 s before the first job, a 4 s gap before the two parallel jobs, and
    // 2 s before the gate. The parallel jobs overlap, so they leave no gap.
    jobs: [job("scope", 3, 10), job("static", 14, 40), job("database", 15, 100), job("gate", 102, 108)],
  };
  assert.deepEqual(runTimes(run), { runSeconds: 108, queueSeconds: 9, jobSeconds: 7 + 26 + 85 + 6, fullSuite: true });
});

test("skipped jobs do not count, and two jobs mean the documents-only path", () => {
  const run = { attempt: 1, created_at: at(0), run_started_at: at(0), jobs: [job("scope", 2, 10), skipped("static"), skipped("database"), job("gate", 13, 18)] };
  assert.deepEqual(runTimes(run), { runSeconds: 18, queueSeconds: 5, jobSeconds: 13, fullSuite: false });
  assert.equal(runTimes({ run_started_at: at(0), jobs: [skipped("static")] }), null);
});

test("the summary keeps full-suite and documents-only runs apart and groups shard steps", () => {
  const step = (name, start, end) => ({ name, conclusion: "success", started_at: at(start), completed_at: at(end) });
  const full = (attempt, offset) => ({
    attempt, created_at: at(0), run_started_at: at(0),
    jobs: [job("scope", 2, 8), job("End-to-end tests (1/2)", 10, 50 + offset, [step("Run tests", 20, 50 + offset)]),
      job("End-to-end tests (2/2)", 10, 40, [step("Run tests", 20, 40)]), job("gate", 52 + offset, 55 + offset)],
  });
  const documents = { attempt: 1, created_at: at(1), run_started_at: at(1), jobs: [job("scope", 3, 9), job("gate", 11, 15)] };
  const result = summarize([full(1, 0), full(2, 10), documents]);
  assert.equal(result.all.runs, 3);
  assert.equal(result.fullSuite.runs, 2);
  assert.equal(result.fullSuite.rerun, 1);
  assert.deepEqual(result.fullSuite.runSeconds, { n: 2, median: 60, p90: 65, min: 55, max: 65 });
  assert.equal(result.documentsOnly.runs, 1);
  assert.deepEqual(result.steps["End-to-end tests / Run tests"], { n: 4, median: 25, p90: 40, min: 20, max: 40 });
});

test("the re-run rate leaves cancelled runs out", () => {
  const window = [
    { attempt: 1, conclusion: "success" }, { attempt: 2, conclusion: "success" }, { attempt: 1, conclusion: "failure" },
    { attempt: 1, conclusion: "cancelled" }, { attempt: 3, conclusion: "failure" },
  ];
  assert.deepEqual(windowRates(window), { completed: 5, cancelled: 1, finished: 4, failed: 2, rerun: 2, rerunRate: 0.5 });
  assert.equal(windowRates([]).rerunRate, null);
});
