// Gives every checkout its own local Supabase stack, so parallel agents never
// reset each other's database. The main checkout keeps slot 0 and the ports in
// supabase/config.toml. A linked worktree takes one of SLOT_COUNT slots: its
// supabase/ folder is mirrored into .local-db/ with a slot-specific project_id
// and every port shifted by slot * PORT_STEP, then started from there.
//
// Run through npm: `npm run db:start | db:stop | db:reset | db:status`.
// Node 24 runs this file directly (type stripping), so keep to erasable syntax.

import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

export const BASE_PROJECT_ID = "al-rahmah-web"
export const SLOT_COUNT = 3
export const PORT_STEP = 100
export const E2E_BASE_PORT = 3100
export const DEV_BASE_PORT = 3000
const MIRROR_DIR = ".local-db"

// Everything the app does not use. What stays: Postgres, Auth (gotrue), REST
// (postgrest), Kong in front of them, and Mailpit to catch invite emails.
// That set is about 450 MB, against about 2 GB for the full stack.
export const SLIM_EXCLUDES = [
  "realtime",
  "storage-api",
  "imgproxy",
  "postgres-meta",
  "studio",
  "edge-runtime",
  "logflare",
  "vector",
  "supavisor",
]

export function projectIdFor(slot: number): string {
  return slot === 0 ? BASE_PROJECT_ID : `${BASE_PROJECT_ID}-slot${slot}`
}

export function portsFor(slot: number) {
  return { e2e: E2E_BASE_PORT + slot, dev: DEV_BASE_PORT + slot }
}

// Rewrites config.toml for a slot: the project_id, every uncommented port
// setting, and the dev-server port in auth redirect URLs.
export function rewriteConfig(toml: string, slot: number): string {
  const offset = slot * PORT_STEP
  const dev = portsFor(slot).dev
  return toml
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return line
      if (/^\s*project_id\s*=/.test(line)) return `project_id = "${projectIdFor(slot)}"`
      const port = line.match(/^(\s*(?:port|shadow_port|inspector_port)\s*=\s*)(\d+)(.*)$/)
      if (port) return `${port[1]}${Number(port[2]) + offset}${port[3]}`
      if (/^\s*(site_url|additional_redirect_urls)\s*=/.test(line)) {
        return line.replaceAll(`:${DEV_BASE_PORT}`, `:${dev}`)
      }
      return line
    })
    .join("\n")
}

export type SlotClaim = {
  slot: number
  // The worktree that last took the slot.
  worktree: string
  // Whether that slot's database container is running right now.
  running: boolean
}

// Chooses the slot for `worktree`, or null when every slot is held.
// `claims` holds one entry per slot that has a claim file, in any order.
export function pickSlot(claims: SlotClaim[], worktree: string): number | null {
  // TODO(human)
  return null
}

// Replaces or appends KEY=value lines, keeping every other line as it was.
export function mergeEnv(existing: string, values: Record<string, string>): string {
  const lines = existing === "" ? [] : existing.replace(/\n$/, "").split("\n")
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`))
    if (index === -1) lines.push(`${key}=${value}`)
    else lines[index] = `${key}=${value}`
  }
  return lines.join("\n") + "\n"
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

function supabase(args: string[]): number {
  const result = spawnSync("npx", ["supabase", ...args], { stdio: "inherit", shell: process.platform === "win32" })
  return result.status ?? 1
}

function isRunning(slot: number): boolean {
  const name = `supabase_db_${projectIdFor(slot)}`
  const out = spawnSync("docker", ["ps", "--filter", `name=^${name}$`, "--format", "{{.Names}}"], { encoding: "utf8" })
  return out.stdout.trim() === name
}

type Checkout = { root: string; isMain: boolean; claimsDir: string }

function checkout(): Checkout {
  const root = resolve(git("rev-parse", "--show-toplevel"))
  const gitDir = resolve(root, git("rev-parse", "--git-dir"))
  const commonDir = resolve(root, git("rev-parse", "--git-common-dir"))
  return { root, isMain: gitDir === commonDir, claimsDir: join(commonDir, "local-db-slots") }
}

function readClaims(claimsDir: string): SlotClaim[] {
  if (!existsSync(claimsDir)) return []
  return readdirSync(claimsDir)
    .map((file) => file.match(/^slot(\d+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => {
      const slot = Number(match[1])
      const worktree = readFileSync(join(claimsDir, match[0]), "utf8").trim()
      return { slot, worktree, running: isRunning(slot) }
    })
}

function slotFor(co: Checkout): number | null {
  if (co.isMain) return 0
  return pickSlot(readClaims(co.claimsDir), co.root)
}

// Copies supabase/ into .local-db/supabase with the slot's config, so the
// mirror always carries the branch's current migrations and seed.
function mirror(co: Checkout, slot: number) {
  const target = join(co.root, MIRROR_DIR, "supabase")
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(join(co.root, "supabase"), target, {
    recursive: true,
    filter: (source) => !/[\\/]supabase[\\/]\.(temp|branches)([\\/]|$)/.test(source),
  })
  const config = join(target, "config.toml")
  writeFileSync(config, rewriteConfig(readFileSync(config, "utf8"), slot))
}

function workdirArgs(co: Checkout): string[] {
  return co.isMain ? [] : ["--workdir", join(co.root, MIRROR_DIR)]
}

function writeEnvLocal(co: Checkout, slot: number) {
  const status = spawnSync("npx", ["supabase", "status", "-o", "env", ...workdirArgs(co)], {
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  const values = Object.fromEntries(
    status.stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)="?([^"]*)"?$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], match[2]]),
  )
  if (!values.API_URL || !values.PUBLISHABLE_KEY) {
    throw new Error("`supabase status` did not report API_URL and PUBLISHABLE_KEY.")
  }
  const path = join(co.root, ".env.local")
  const existing = existsSync(path) ? readFileSync(path, "utf8") : ""
  writeFileSync(
    path,
    mergeEnv(existing, {
      NEXT_PUBLIC_SUPABASE_URL: values.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY,
      E2E_PORT: String(portsFor(slot).e2e),
    }),
  )
}

function describeClaims(co: Checkout): string {
  const claims = readClaims(co.claimsDir).sort((a, b) => a.slot - b.slot)
  if (claims.length === 0) return "  (no worktree slots claimed)"
  return claims.map((c) => `  slot ${c.slot}: ${c.running ? "running" : "stopped"}  ${c.worktree}`).join("\n")
}

function main(command: string | undefined, flags: string[]): number {
  const co = checkout()
  const full = flags.includes("--full")

  if (command === "status") {
    console.log(`This checkout: ${co.isMain ? "main checkout (slot 0)" : co.root}`)
    console.log(describeClaims(co))
    return 0
  }

  const slot = slotFor(co)
  if (slot === null) {
    console.error(`All ${SLOT_COUNT} worktree database slots are in use:\n${describeClaims(co)}`)
    console.error("Wait for one to stop, or ask the human. Never stop another worktree's stack.")
    return 1
  }

  if (command === "stop") {
    const code = supabase(["stop", ...workdirArgs(co)])
    if (!co.isMain) rmSync(join(co.claimsDir, `slot${slot}`), { force: true })
    return code
  }

  if (command === "start" || command === "reset") {
    if (!co.isMain) {
      mkdirSync(co.claimsDir, { recursive: true })
      writeFileSync(join(co.claimsDir, `slot${slot}`), co.root)
      mirror(co, slot)
    }
    const args =
      command === "start"
        ? ["start", ...workdirArgs(co), ...(full ? [] : ["-x", SLIM_EXCLUDES.join(",")])]
        : ["db", "reset", ...workdirArgs(co)]
    const code = supabase(args)
    if (code !== 0) return code
    writeEnvLocal(co, slot)
    const { dev, e2e } = portsFor(slot)
    console.log(`\nSlot ${slot} (${projectIdFor(slot)}). .env.local is up to date.`)
    console.log(`Dev server: npm run dev -- -p ${dev}   e2e server: port ${e2e}`)
    return 0
  }

  console.error("Usage: node scripts/local-db.ts <start|stop|reset|status> [--full]")
  return 1
}

if (import.meta.main) process.exit(main(process.argv[2], process.argv.slice(3)))
