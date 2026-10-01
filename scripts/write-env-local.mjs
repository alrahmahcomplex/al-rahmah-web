// Writes .env.local for this checkout from the running local Supabase
// (`npm run db:start`), keeping any other values already in the file. Local
// keys only: it never sees a hosted project. Used by CI and by each worktree.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const status = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", shell: true })
const local = Object.fromEntries(
  status
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
)

const wanted = {
  NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: local.SECRET_KEY,
  SUPABASE_DB_URL: local.DB_URL,
}
for (const [name, value] of Object.entries(wanted)) {
  if (!value) throw new Error(`supabase status did not report a value for ${name}. Is local Supabase running?`)
}

// Values from .env.example (the always-pass test keys, for instance) come
// first, then whatever .env.local already holds, then the local Supabase ones.
const parse = (file) =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, "utf8")
          .split(/\r?\n/)
          .map((line) => line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/))
          .filter((match) => match && match[2] !== "")
          .map((match) => [match[1], match[2]]),
      )
    : {}

const merged = { ...parse(".env.example"), ...parse(".env.local"), ...wanted }
writeFileSync(".env.local", Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n")
console.log(`Wrote .env.local with ${Object.keys(merged).join(", ")}`)
