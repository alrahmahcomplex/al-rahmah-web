import assert from "node:assert/strict";
import test from "node:test";
import { collisionTitle, decide, duplicateOf, errors, stillCurrent, vitestReport } from "./ci-retry.mjs";

const stamp = "2026-11-12T11:10:24.8736182Z ";
const log = (lines) => lines.map((line) => stamp + line).join("\n");

// A failed integration shard as Vitest's default reporter and its GitHub
// annotations print it. blocks: [[test, ...], error line]; annotations: the
// ##[error] lines Vitest wrote.
function shard(blocks, { annotations = blocks.map(([, error]) => error), failed = blocks.flatMap(([tests]) => tests).length, extra = [] } = {}) {
  return log([
    "\u001b[31m⎯⎯⎯⎯⎯⎯⎯\u001b[39m\u001b[1m\u001b[41m Failed Tests " + failed + " \u001b[49m\u001b[22m\u001b[31m⎯⎯⎯⎯⎯⎯⎯\u001b[39m",
    "",
    ...blocks.flatMap(([tests, error], index) => [
      ...tests.map((name) => ` FAIL   integration  ${name}`),
      error,
      " ❯ node_modules/pg/lib/client.js:694:17",
      "",
      `⎯⎯⎯⎯⎯⎯⎯⎯⎯[${index + 1}/${blocks.length}]⎯`,
      "",
    ]),
    ...extra,
    ` Test Files  1 failed | 49 passed (50)`,
    `      Tests  ${failed} failed | 918 passed (${918 + failed})`,
    ...annotations.map((message) => `##[error]${message}`),
    "##[error]Process completed with exit code 1.",
  ]);
}

const victim = "tests/integration/sibling-result.test.ts > lock order > the student import's Enrolled locks";
const deadlock = shard([[[victim], "error: deadlock detected"]]);
const assertion = shard([[["tests/integration/sibling-counts.test.ts > counts > a group of three"], "AssertionError: expected 1 to be +0 // Object.is equality"]]);
const gate = { name: "CI complete", log: log(["##[error]Process completed with exit code 1."]) };
const pull = (failedJobs, attempt = 1) => decide({ event: "pull_request", attempt, failedJobs });

test("errors are the annotations, without the step's closing line or colour codes", () => {
  assert.deepEqual(errors(log(["\u001b[31m##[error]error: fee_snapshot_changed\u001b[39m", "##[error]Process completed with exit code 1.", "plain line"])), ["error: fee_snapshot_changed"]);
});

test("Vitest's report gives each failure block's tests and error, and the failed count", () => {
  const report = vitestReport(shard([[["tests/integration/a.test.ts > one", "tests/integration/b.test.ts > two"], "error: deadlock detected"], [["tests/integration/c.test.ts > three"], "error: canceling statement due to lock timeout"]]));
  assert.equal(report.failed, 3);
  assert.equal(report.other, false);
  assert.deepEqual(report.blocks, [
    { tests: ["tests/integration/a.test.ts > one", "tests/integration/b.test.ts > two"], error: "error: deadlock detected" },
    { tests: ["tests/integration/c.test.ts > three"], error: "error: canceling statement due to lock timeout" },
  ]);
});

test("a pull request run that failed only on a deadlock is re-run once and reported", () => {
  const decision = pull([{ name: "Integration tests (2/2)", log: deadlock }, gate]);
  assert.equal(decision.rerun, true, decision.reason);
  assert.equal(decision.issue, "collision");
  assert.deepEqual(decision.collisions, ["deadlock"]);
  assert.deepEqual(decision.tests, [victim]);
});

test("lock timeouts and fee snapshot errors count as collisions too", () => {
  const both = shard([[["tests/integration/a.test.ts > one"], "error: canceling statement due to lock timeout"], [["tests/integration/b.test.ts > two"], "error: fee_snapshot_changed"]]);
  const decision = decide({ event: "push", attempt: 1, failedJobs: [{ name: "Integration tests (1/2)", log: both }] });
  assert.equal(decision.rerun, true, decision.reason);
  assert.deepEqual(decision.collisions.sort(), ["fee snapshot", "lock timeout"]);
});

test("a second collision is reported but not re-run again", () => {
  const decision = pull([{ name: "Integration tests (1/2)", log: deadlock }], 2);
  assert.equal(decision.rerun, false);
  assert.equal(decision.issue, "collision");
});

test("an assertion that only mentions a collision word is a real failure", () => {
  for (const message of ["AssertionError: expected 'success' to be 'fee_snapshot_changed'", "Error: deadlock detected in my own check", "error: deadlock detected, and more"]) {
    const decision = pull([{ name: "Integration tests (1/2)", log: shard([[[victim], message]]) }]);
    assert.equal(decision.rerun, false, message);
    assert.equal(decision.issue, null);
  }
});

test("a collision line followed by more message text is a different error", () => {
  // Vitest prints every line of an error's message before its stack.
  const multiline = log([
    "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯",
    "",
    ` FAIL   integration  ${victim}`,
    "error: deadlock detected",
    " ❯ node_modules/pg/lib/client.js:694:17",
    "",
    "⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯",
    "",
    " FAIL   integration  tests/integration/x.test.ts > y",
    "error: deadlock detected",
    "This operation failed for another reason",
    "",
    "⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯",
    "",
    " Test Files  2 failed | 48 passed (50)",
    "      Tests  2 failed | 917 passed (919)",
    "##[error]error: deadlock detected",
    "##[error]Process completed with exit code 1.",
  ]);
  const report = vitestReport(multiline);
  assert.deepEqual(report.blocks.map((block) => block.error), ["error: deadlock detected", "error: deadlock detected\nThis operation failed for another reason"]);
  assert.equal(pull([{ name: "Integration tests (1/2)", log: multiline }]).rerun, false);
  // The real shape: one message line, then the stack, a code frame and a
  // Serialized Error after it.
  const real = log([
    "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
    "",
    ` FAIL   integration  ${victim}`,
    "error: deadlock detected",
    " ❯ node_modules/pg/lib/client.js:694:17",
    " ❯ tests/integration/sibling-result.test.ts:219:7",
    "    219|       await sql.query(\"update public.leads set status = 'Enrolled'…",
    "       |       ^",
    "",
    "⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
    "",
    " Test Files  1 failed | 48 passed (49)",
    "      Tests  1 failed | 806 passed (807)",
    "##[error]error: deadlock detected",
    "##[error]Process completed with exit code 1.",
  ]);
  assert.equal(pull([{ name: "Integration tests (2/2)", log: real }]).rerun, true);
});

test("a real failure stays red beside a deadlock, annotated or not", () => {
  assert.equal(pull([{ name: "Integration tests (1/2)", log: deadlock }, { name: "Integration tests (2/2)", log: assertion }]).rerun, false);
  const mixed = shard([[[victim], "error: deadlock detected"], [["tests/integration/x.test.ts > y"], "TypeError: cannot read properties of undefined"]]);
  assert.equal(pull([{ name: "Integration tests (1/2)", log: mixed }]).rerun, false);
  // Vitest writes no annotation for an error without a usable stack: the
  // block still names it.
  const unannotated = shard([[[victim], "error: deadlock detected"], [["tests/integration/x.test.ts > y"], "Error: something else"]], { annotations: ["error: deadlock detected"] });
  assert.equal(pull([{ name: "Integration tests (1/2)", log: unannotated }]).rerun, false);
  // More failed tests than the blocks name.
  const uncounted = shard([[[victim], "error: deadlock detected"]], { failed: 2 });
  assert.equal(pull([{ name: "Integration tests (1/2)", log: uncounted }]).rerun, false);
  // A failed suite or an unhandled error.
  const suite = shard([[[victim], "error: deadlock detected"]], { extra: ["⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯", " FAIL  integration tests/integration/z.test.ts"] });
  assert.equal(pull([{ name: "Integration tests (1/2)", log: suite }]).rerun, false);
  const unhandled = shard([[[victim], "error: deadlock detected"]], { extra: ["⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯"] });
  assert.equal(pull([{ name: "Integration tests (1/2)", log: unhandled }]).rerun, false);
});

test("timeouts, setup failures, unreadable logs and other jobs are never re-run", () => {
  for (const failedJobs of [
    [{ name: "Integration tests (1/2)", log: shard([[[victim], "Error: Test timed out in 30000ms."]]) }],
    [{ name: "Integration tests (1/2)", log: log(['##[error]Error: setup failed: {"kind":"unavailable"}']) }],
    [{ name: "Integration tests (1/2)", log: log(["##[error]error: deadlock detected"]) }],
    [{ name: "Integration tests (1/2)", log: "" }],
    [{ name: "Browser tests (3/8)", log: deadlock }],
    [{ name: "Lint, typecheck and unit tests", log: deadlock }],
    [gate],
  ]) assert.equal(pull(failedJobs).rerun, false);
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

test("a pull request run is re-run only while it is for the pull request's head", () => {
  assert.equal(stillCurrent({ event: "pull_request", runSha: "a1", heads: ["a1"] }), true);
  assert.equal(stillCurrent({ event: "pull_request", runSha: "a1", heads: ["b2"] }), false, "a newer push has its own run");
  assert.equal(stillCurrent({ event: "pull_request", runSha: "a1", heads: [] }), false, "no pull request found: leave it");
  assert.equal(stillCurrent({ event: "push", runSha: "a1", heads: [] }), true, "main's runs never cancel each other");
});

test("of two issues opened at once, each run closes only its own newer one", () => {
  assert.equal(duplicateOf(12, [12]), null);
  assert.equal(duplicateOf(12, [11, 12]), 11, "the newer run moves its report to the older issue");
  assert.equal(duplicateOf(11, [11, 12]), null, "the older run keeps its issue");
  assert.equal(duplicateOf(12, []), null);
});
