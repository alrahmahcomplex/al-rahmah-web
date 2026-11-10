import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RESULTS, checkErrors, fileSeconds, plan, readConfig, reportTests, specFiles, verifyErrors } from "./e2e-shards.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

// A Playwright JSON report with the given tests: [file, title, results].
function report(tests) {
  const suites = new Map();
  for (const [file, title, results = [{ duration: 1000 }], project = "chromium"] of tests) {
    if (!suites.has(file)) suites.set(file, { title: file, file, specs: [], suites: [{ title: "group", file, specs: [] }] });
    // Every second test sits in a nested describe block, as real reports have.
    const suite = suites.get(file);
    const target = suite.specs.length <= suite.suites[0].specs.length ? suite : suite.suites[0];
    target.specs.push({ title, file, tests: [{ projectName: project, results }] });
  }
  return { suites: [...suites.values()] };
}

test("every spec file lands in exactly one shard, for any number of shards and any measurements", () => {
  const files = Array.from({ length: 53 }, (_, index) => `file-${index}.spec.ts`);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let shards = 1; shards <= 12; shards += 1) {
    for (const seconds of [{}, Object.fromEntries(files.map((file) => [file, random() * 90])), Object.fromEntries(files.slice(0, 20).map((file) => [file, random() * 90])), { "file-3.spec.ts": NaN, "file-4.spec.ts": -5, "gone.spec.ts": 40 }]) {
      const result = plan(files, seconds, shards);
      assert.equal(result.length, shards);
      assert.deepEqual(result.flatMap((shard) => shard.files).sort(), [...files].sort());
    }
  }
});

test("shards come out near equal: no shard is ahead of another by more than one file", () => {
  const seconds = { "a.spec.ts": 97, "b.spec.ts": 91, "c.spec.ts": 86, "d.spec.ts": 81, "e.spec.ts": 51, "f.spec.ts": 43, "g.spec.ts": 40, "h.spec.ts": 25, "i.spec.ts": 12, "j.spec.ts": 3 };
  const result = plan(Object.keys(seconds), seconds, 3);
  const totals = result.map((shard) => shard.seconds);
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 97, totals.join(", "));
  assert.equal(Math.round(totals.reduce((sum, value) => sum + value, 0)), 529);
  // The same input always gives the same shards.
  assert.deepEqual(plan(Object.keys(seconds).reverse(), seconds, 3), result);
});

test("a spec file without a measurement counts as the median file", () => {
  const result = plan(["new.spec.ts", "a.spec.ts", "b.spec.ts", "c.spec.ts"], { "a.spec.ts": 10, "b.spec.ts": 30, "c.spec.ts": 50 }, 1);
  assert.equal(result[0].seconds, 10 + 30 + 50 + 30);
});

test("the check refuses a test no shard runs, a file in two shards and a spec file with no tests", () => {
  const files = ["a.spec.ts", "b.spec.ts"];
  const shards = plan(files, {}, 2);
  const listed = reportTests(report([["a.spec.ts", "one"], ["a.spec.ts", "two"], ["b.spec.ts", "three"]]));
  assert.equal(listed.length, 3);
  assert.deepEqual(checkErrors(files, shards, listed), []);
  assert.match(checkErrors(files, shards, reportTests(report([["a.spec.ts", "one"], ["b.spec.ts", "two"], ["c.test.ts", "three"]]))).join("\n"), /c\.test\.ts has tests, but no shard runs it/);
  assert.match(checkErrors(files, shards, reportTests(report([["a.spec.ts", "one"]]))).join("\n"), /b\.spec\.ts is in a shard, but Playwright lists no test in it/);
  assert.match(checkErrors(files, [{ files: ["a.spec.ts", "b.spec.ts"] }, { files: ["a.spec.ts"] }], listed).join("\n"), /a\.spec\.ts is in more than one shard/);
  assert.match(checkErrors(files, [{ files: ["a.spec.ts"] }], listed).join("\n"), /no shard runs it/);
});

test("after a run, the shard must have run its own files, all of their tests and nothing else", () => {
  const mine = ["a.spec.ts", "b.spec.ts"];
  assert.deepEqual(verifyErrors(mine, reportTests(report([["a.spec.ts", "one"], ["b.spec.ts", "two"]]))), []);
  assert.match(verifyErrors(mine, reportTests(report([["a.spec.ts", "one"]]))).join("\n"), /b\.spec\.ts belongs to this shard, but none of its tests ran/);
  assert.match(verifyErrors(mine, reportTests(report([["a.spec.ts", "one"], ["b.spec.ts", "two"], ["c.spec.ts", "three"]]))).join("\n"), /c\.spec\.ts ran, but belongs to another shard/);
  assert.match(verifyErrors(mine, reportTests(report([["a.spec.ts", "one"], ["b.spec.ts", "two", []]]))).join("\n"), /b\.spec\.ts: "two" \[chromium\] did not run/);
});

test("measured seconds use each test's last attempt and sum both projects", () => {
  const first = report([["a.spec.ts", "one", [{ duration: 30000 }, { duration: 4200 }]], ["a.spec.ts", "two", [{ duration: 1849 }]]]);
  const second = report([["b.spec.ts", "three", [{ duration: 500 }], "turnstile-fails"], ["b.spec.ts", "four", []]]);
  assert.deepEqual(fileSeconds([first, second]), { "a.spec.ts": 6, "b.spec.ts": 0.5 });
});

test("the workflow runs one job for each shard of e2e/shards.json", () => {
  const { shards } = readConfig(new URL("e2e/shards.json", root));
  const matrix = read(".github/workflows/ci.yml").match(/^ {8}shard: \[([\d, ]+)\]$/m);
  assert.ok(matrix, "the browser job's matrix was not found");
  assert.deepEqual(matrix[1].split(",").map((value) => Number(value.trim())), Array.from({ length: shards }, (_, index) => index + 1));
});

test("Playwright writes its CI report where the shard check reads it", () => {
  assert.ok(read("playwright.config.ts").includes(`outputFile: "${RESULTS}"`));
});

test("spec files are found the way Playwright finds them, helpers left out", () => {
  const files = specFiles(fileURLToPath(new URL("e2e", root)));
  assert.ok(files.includes("login.spec.ts"));
  assert.ok(files.includes("admission-form.turnstile-fails.spec.ts"));
  assert.ok(!files.includes("log-in.ts") && !files.includes("global-setup.ts"));
  assert.ok(files.every((file) => !file.includes("\\") && !file.startsWith("/")));
});
