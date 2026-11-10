import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LOCAL_PUBLISHABLE_KEY, apiPort, buildEnv, changedPublicValues, parseEnv } from "./ci-build-env.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the build's values are .env.example's plus local Supabase's address and publishable key", () => {
  const env = buildEnv("# comment\nNEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00\nEMAIL_DAILY_CAP=100\n", "[api]\nenabled = true\nport = 55421\n[db]\nport = 55422\n");
  assert.deepEqual(env, {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00",
    EMAIL_DAILY_CAP: "100",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55421",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_PUBLISHABLE_KEY,
  });
});

test("the API port is read from the [api] section only", () => {
  assert.equal(apiPort("[db]\nport = 1\n[api]\n# port = 2\nport = 3\n[api.tls]\nport = 4\n"), 3);
  assert.throws(() => apiPort("[db]\nport = 1\n"));
  assert.throws(() => apiPort("[api]\nenabled = true\n[db]\nport = 1\n"));
});

test("this repository's files give the build what it needs", () => {
  const env = buildEnv(read(".env.example"), read("supabase/config.toml"));
  assert.match(env.NEXT_PUBLIC_SUPABASE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, "the build needs the Turnstile site key of .env.example");
  // .env.example must leave the Supabase values empty, or it would be unclear which value wins.
  const example = parseEnv(read(".env.example"));
  assert.equal(example.NEXT_PUBLIC_SUPABASE_URL, undefined);
  assert.equal(example.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, undefined);
});

test("the check names every NEXT_PUBLIC_ value that changed, appeared or went away, and ignores the rest", () => {
  const built = { NEXT_PUBLIC_A: "1", NEXT_PUBLIC_B: "2", NEXT_PUBLIC_GONE: "3", SERVER_ONLY: "x" };
  assert.deepEqual(changedPublicValues(built, { ...built, SERVER_ONLY: "y", SUPABASE_SECRET_KEY: "s" }), []);
  assert.deepEqual(changedPublicValues(built, { NEXT_PUBLIC_A: "1", NEXT_PUBLIC_B: "other", NEXT_PUBLIC_NEW: "4" }), ["NEXT_PUBLIC_B", "NEXT_PUBLIC_GONE", "NEXT_PUBLIC_NEW"]);
});
