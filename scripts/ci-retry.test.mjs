import assert from "node:assert/strict";
import test from "node:test";
import { collisionTitle, decide, errors } from "./ci-retry.mjs";

const stamp = "2026-11-12T11:10:24.8736182Z ";
const log = (lines) => lines.map((line) => stamp + line).join("\n");
const deadlock = log([
  " FAIL  integration tests/integration/sibling-result.test.ts > lock order > the student import's Enrolled locks",
  "##[error]error: deadlock detected",
  "##[error]Process completed with exit code 1.",
]);
const assertion = log([
  " FAIL  integration tests/integration/sibling-counts.test.ts > counts > a group of three",
  "##[error]AssertionError: expected 1 to be +0 // Object.is equality",
  "##[error]Process completed with exit code 1.",
]);
const gate = { name: "CI complete", log: log(["##[error]Process completed with exit code 1."]) };

test("errors are the annotations, without the step's closing line or colour codes", () => {
  assert.deepEqual(errors(log(["\u001b[31m##[error]error: fee_snapshot_changed\u001b[39m", "##[error]Process completed with exit code 1.", "plain line"])), ["error: fee_snapshot_changed"]);
});

test("a pull request run that failed only on a deadlock is re-run once and reported", () => {
  const decision = decide({ event: "pull_request", attempt: 1, failedJobs: [{ name: "Integration tests (2/2)", log: deadlock }, gate] });
  assert.equal(decision.rerun, true);
  assert.equal(decision.issue, "collision");
  assert.deepEqual(decision.collisions, ["deadlock"]);
  assert.deepEqual(decision.tests, ["tests/integration/sibling-result.test.ts > lock order > the student import's Enrolled locks"]);
});

test("lock timeouts and fee snapshot errors count as collisions too", () => {
  const other = log(["##[error]error: canceling statement due to lock timeout", "##[error]error: fee_snapshot_changed"]);
  const decision = decide({ event: "push", attempt: 1, failedJobs: [{ name: "Integration tests (1/2)", log: other }] });
  assert.equal(decision.rerun, true);
  assert.deepEqual(decision.collisions.sort(), ["fee snapshot", "lock timeout"]);
});

test("a second collision is reported but not re-run again", () => {
  const decision = decide({ event: "pull_request", attempt: 2, failedJobs: [{ name: "Integration tests (1/2)", log: deadlock }] });
  assert.equal(decision.rerun, false);
  assert.equal(decision.issue, "collision");
});

test("a real failure stays red, even beside a deadlock", () => {
  const both = decide({ event: "pull_request", attempt: 1, failedJobs: [{ name: "Integration tests (1/2)", log: deadlock }, { name: "Integration tests (2/2)", log: assertion }] });
  assert.equal(both.rerun, false);
  assert.equal(both.issue, null);
  const mixed = decide({ event: "pull_request", attempt: 1, failedJobs: [{ name: "Integration tests (1/2)", log: deadlock + "\n" + assertion }] });
  assert.equal(mixed.rerun, false);
});

test("timeouts, setup failures, unreadable logs and other jobs are never re-run", () => {
  const timeout = log(["##[error]Error: Test timed out in 30000ms."]);
  for (const failedJobs of [
    [{ name: "Integration tests (1/2)", log: timeout }],
    [{ name: "Integration tests (1/2)", log: log(['##[error]Error: setup failed: {"kind":"unavailable"}']) }],
    [{ name: "Integration tests (1/2)", log: "" }],
    [{ name: "Browser tests (3/8)", log: deadlock }],
    [{ name: "Lint, typecheck and unit tests", log: deadlock }],
    [gate],
  ]) assert.equal(decide({ event: "pull_request", attempt: 1, failedJobs }).rerun, false);
});

test("a failed nightly run opens an issue and is not re-run", () => {
  const collided = decide({ event: "schedule", attempt: 1, failedJobs: [{ name: "Integration tests (1/2)", log: deadlock }] });
  assert.equal(collided.rerun, false);
  assert.equal(collided.issue, "nightly");
  const broken = decide({ event: "schedule", attempt: 1, failedJobs: [{ name: "Browser tests (1/8)", log: assertion }] });
  assert.equal(broken.issue, "nightly");
});

test("the issue title names the test files, so one collision keeps one issue", () => {
  assert.equal(collisionTitle(["tests/integration/b.test.ts > x", "tests/integration/a.test.ts > y", "tests/integration/b.test.ts > z"]), "Tests collide in the database: a.test.ts, b.test.ts");
  assert.equal(collisionTitle([]), "Tests collide in the database: unknown test");
});
