// Lets CI build the app while local Supabase is still starting.
//
//   node scripts/ci-build-env.mjs write   before the build and before Supabase is up
//   node scripts/ci-build-env.mjs check   after `npm run env:local`
//
// `next build` puts the NEXT_PUBLIC_ values into the pages, so it needs them
// before it starts. For local Supabase they are the same on every machine:
// the address comes from supabase/config.toml, and the publishable key is the
// CLI's fixed local one. `write` puts them in .env.local with the values of
// .env.example. `check` then compares every NEXT_PUBLIC_ value the build read
// with what the running stack reports, and fails if one differs, so a build
// made with a stale value can never be tested.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// What `supabase status` prints as the Publishable key of every local stack.
// It is public by design: the browser receives it.
export const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const BUILT_WITH = ".env.build";

export function parseEnv(text) {
  return Object.fromEntries(
    text.split(/\r?\n/).map((line) => line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter((match) => match && match[2] !== "").map((match) => [match[1], match[2]]),
  );
}

// The API port of the [api] section of supabase/config.toml.
export function apiPort(configToml) {
  const section = configToml.split(/^\[/m).find((part) => part.startsWith("api]"));
  const port = section?.match(/^port\s*=\s*(\d+)\s*$/m)?.[1];
  if (!port) throw new Error("supabase/config.toml has no [api] port");
  return Number(port);
}

export function buildEnv(exampleText, configToml) {
  return {
    ...parseEnv(exampleText),
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${apiPort(configToml)}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_PUBLISHABLE_KEY,
  };
}

const publicValues = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith("NEXT_PUBLIC_")).sort());

// The names whose value the build read differs from the value in use now.
export function changedPublicValues(builtWith, now) {
  const before = publicValues(builtWith);
  const after = publicValues(now);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) => before[name] !== after[name]).sort();
}

const serialize = (env) => `${Object.entries(env).map(([name, value]) => `${name}=${value}`).join("\n")}\n`;

function main() {
  const command = process.argv[2];
  if (command === "write") {
    if (existsSync(".env.local")) throw new Error(".env.local already exists. This command is for a fresh CI checkout.");
    const env = buildEnv(readFileSync(".env.example", "utf8"), readFileSync("supabase/config.toml", "utf8"));
    writeFileSync(".env.local", serialize(env));
    writeFileSync(BUILT_WITH, serialize(env));
    console.log(`Wrote .env.local for the build with ${Object.keys(env).join(", ")}`);
  } else if (command === "check") {
    const changed = changedPublicValues(parseEnv(readFileSync(BUILT_WITH, "utf8")), parseEnv(readFileSync(".env.local", "utf8")));
    if (changed.length) {
      throw new Error(`The build read a different value than local Supabase reports for: ${changed.join(", ")}.\n` +
        "Update scripts/ci-build-env.mjs to the values `npx supabase status -o env` prints.");
    }
    console.log("The build read the same NEXT_PUBLIC_ values that local Supabase reports.");
  } else {
    throw new Error("Usage: ci-build-env.mjs write | check");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
