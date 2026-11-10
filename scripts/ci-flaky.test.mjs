import assert from "node:assert/strict";
import test from "node:test";
import { playwrightOutcomes, vitestFailures } from "./ci-flaky.mjs";

const stamp = "2026-11-09T20:45:02.5137239Z ";
const log = (lines) => lines.map((line) => stamp + line).join("\n");

test("Playwright's summary gives the failed and the flaky tests, without line numbers", () => {
  const outcomes = playwrightOutcomes(log([
    "  ✓  12 [chromium] › e2e/login.spec.ts:10:5 › signs in (2.1s)",
    "",
    "  2 failed",
    "    [chromium] › e2e/seats.spec.ts:40:7 › the class is full › a late payment waits ",
    "    [turnstile-fails] › e2e/admission-form.turnstile-fails.spec.ts:8:5 › a failed check is refused ",
    "  1 flaky",
    "    [chromium] › e2e/marketing-agents.spec.ts:235:11 › Marketing Agents › the Manager approves ",
    "  376 passed (22.2m)",
    "Post job cleanup.",
    "    [chromium] › e2e/not-a-test.spec.ts:1:1 › printed after the summary ",
  ]));
  assert.deepEqual(outcomes.failed, [
    "[chromium] › e2e/seats.spec.ts › the class is full › a late payment waits",
    "[turnstile-fails] › e2e/admission-form.turnstile-fails.spec.ts › a failed check is refused",
  ]);
  assert.deepEqual(outcomes.flaky, ["[chromium] › e2e/marketing-agents.spec.ts › Marketing Agents › the Manager approves"]);
});

test("a log with no summary has no outcomes, and colour codes do not hide one", () => {
  assert.deepEqual(playwrightOutcomes(log(["Running 388 tests using 2 workers", "  388 passed (14.7m)"])), { failed: [], flaky: [] });
  const coloured = playwrightOutcomes(log(["\u001b[33m  1 flaky\u001b[39m", "\u001b[33m    [chromium] › e2e/a.spec.ts:3:5 › waits \u001b[39m", "  1 passed (3s)"]));
  assert.deepEqual(coloured.flaky, ["[chromium] › e2e/a.spec.ts › waits"]);
});

test("Vitest failures are listed once each, with or without a project name", () => {
  const failures = vitestFailures(log([
    " FAIL  integration tests/integration/follow-up-queue.test.ts > the queue's sections > Overdue runs oldest first",
    " FAIL  |unit| tests/unit/apply-page.test.tsx > the Admission form page > sends once",
    " FAIL  integration tests/integration/follow-up-queue.test.ts > the queue's sections > Overdue runs oldest first",
    "   × tests/unit/seats.test.ts > counts a seat 12ms",
    " ✓ unit tests/unit/language.test.ts (3 tests) 6ms",
  ]));
  assert.deepEqual(failures, [
    "tests/integration/follow-up-queue.test.ts > the queue's sections > Overdue runs oldest first",
    "tests/unit/apply-page.test.tsx > the Admission form page > sends once",
    "tests/unit/seats.test.ts > counts a seat",
  ]);
});
