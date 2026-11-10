import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const rootDocuments = new Set([
  "README.md", "CHANGELOG.md", "CONTEXT.md", "AGENTS.md", "CLAUDE.md",
]);

export function isProsePath(path) {
  return rootDocuments.has(path) || /^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(path);
}

export function parseNameStatus(output) {
  if (!output) return [];
  const fields = output.split("\0");
  if (fields.pop() !== "") throw new Error("Git diff is not NUL terminated");
  const changes = [];
  while (fields.length) {
    const status = fields.shift();
    if (!/^(?:[ADMTUXB]|[RC]\d+)$/.test(status)) {
      throw new Error(`Unrecognized diff status: ${status}`);
    }
    const count = /^[RC]/.test(status) ? 2 : 1;
    const paths = fields.splice(0, count);
    if (paths.length !== count || paths.some((path) => !path)) {
      throw new Error("Incomplete git diff record");
    }
    changes.push({ status, paths });
  }
  return changes;
}

export function classifyChanges(changes) {
  const paths = [...new Set(changes.flatMap((change) => change.paths))];
  const fullSuite = changes.length === 0 || changes.some(({ status, paths }) =>
    !/^(?:[ADM]|[RC]\d+)$/.test(status) || paths.some((path) => !isProsePath(path)),
  );
  return {
    fullSuite,
    documents: paths.filter(isProsePath),
    reason: fullSuite ? "Code, configuration, unknown change, or empty diff" : "Only allowlisted Markdown changed",
  };
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
}

function commit(sha, cwd) {
  if (typeof sha !== "string" || !/^[a-f\d]{40,64}$/i.test(sha) || /^0+$/.test(sha)) {
    throw new Error("Missing or invalid comparison commit");
  }
  return git(["rev-parse", "--verify", `${sha}^{commit}`], cwd).trim();
}

export function determineScope({ eventName, event, cwd = process.cwd() }) {
  try {
    let base;
    let head;
    if (eventName === "pull_request") {
      const target = commit(event.pull_request?.base?.sha, cwd);
      head = commit(event.pull_request?.head?.sha, cwd);
      base = git(["merge-base", target, head], cwd).trim();
    } else if (eventName === "push") {
      base = commit(event.before, cwd);
      head = commit(event.after, cwd);
    } else {
      throw new Error(`Unsupported event: ${eventName}`);
    }
    const changes = parseNameStatus(git(["diff", "--name-status", "-z", "--find-renames", base, head, "--"], cwd));
    const scope = { ...classifyChanges(changes), base, head, changes };
    // Every merge to main runs every test. The documents-only path is for
    // pull requests alone.
    if (eventName === "push" && !scope.fullSuite) {
      return { ...scope, fullSuite: true, reason: "A push to main always runs the full suite" };
    }
    return scope;
  } catch (error) {
    // A missing comparison never grants the documentation-only shortcut.
    return { fullSuite: true, documents: null, reason: `Full suite required: ${error.message}` };
  }
}

// The jobs of .github/workflows/ci.yml that the gate waits for. It fails when
// one is missing from its `needs`, so a job added there must be added here.
// The always jobs run for every change. The runtime jobs run for the full
// suite and are skipped for a documents-only change. The push jobs run for
// the full suite of a push to main and are skipped for every other event.
export const alwaysJobs = ["repository"];
export const runtimeJobs = ["static", "integration", "browser"];
export const pushJobs = ["caches"];

export function gateErrors(needs, eventName) {
  const errors = [];
  if (needs.scope?.result !== "success") errors.push("The scope job did not succeed");
  const fullSuite = needs.scope?.outputs?.full_suite;
  if (!["true", "false"].includes(fullSuite)) errors.push("Scope did not produce a valid full_suite output");
  const expected = fullSuite === "false" ? "skipped" : "success";
  const known = ["scope", ...alwaysJobs, ...runtimeJobs, ...pushJobs];
  for (const job of Object.keys(needs)) {
    if (!known.includes(job)) errors.push(`${job}: the gate does not know this job`);
  }
  for (const job of alwaysJobs) {
    if (needs[job]?.result !== "success") errors.push(`${job}: expected success, received ${needs[job]?.result ?? "missing"}`);
  }
  for (const job of runtimeJobs) {
    if (needs[job]?.result !== expected) errors.push(`${job}: expected ${expected}, received ${needs[job]?.result ?? "missing"}`);
  }
  const expectedOnPush = eventName === "push" ? expected : "skipped";
  for (const job of pushJobs) {
    if (needs[job]?.result !== expectedOnPush) errors.push(`${job}: expected ${expectedOnPush}, received ${needs[job]?.result ?? "missing"}`);
  }
  return errors;
}

function main() {
  if (process.argv.includes("--gate")) {
    const errors = gateErrors(JSON.parse(process.env.CI_NEEDS ?? "{}"), process.env.GITHUB_EVENT_NAME);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log("All checks required for this change passed.");
    return;
  }
  let scope;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    scope = determineScope({ eventName: process.env.GITHUB_EVENT_NAME, event });
  } catch (error) {
    scope = { fullSuite: true, documents: null, reason: `Full suite required: ${error.message}` };
  }
  console.log(JSON.stringify(scope, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `full_suite=${scope.fullSuite}\ndocuments=${JSON.stringify(scope.documents)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
