import { existsSync } from "node:fs"

// The database tests and the browser tests both talk to local Supabase
// (`npm run db:start`). Values already in the environment win, so CI can set
// them directly.
if (existsSync(".env.local")) process.loadEnvFile(".env.local")
