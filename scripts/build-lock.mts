// Lets one Next.js build run at a time across every checkout of this repo. Two
// builds at once ran this machine (7.7 GB of RAM, about 0.2 GB free at rest)
// out of memory, and both died. `npm run build` and `npm run test:e2e` run
// their job through this script: it takes a lock that every worktree shares,
// waits while another checkout holds it, and releases it when the job exits.
// `test:e2e` holds it for its whole run, because its build happens inside
// Playwright's webServer, whose timeout would otherwise count the wait.
//
// The lock is a directory in the git common dir, like the slot locks in
// local-db.mts: creating a directory either succeeds or fails with EEXIST, so
// two processes can never both hold it. A lock whose holder died is reported,
// never removed automatically: removing it could race with a live holder.
//
// Run through npm: `npm run build` and `npm run test:e2e`.
// Node 24 runs this file directly (type stripping), so keep to erasable syntax.

import { execFileSync, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

// Set in the job's environment to the holder's token, so a build the job
// starts itself (Playwright's webServer runs `npm run build`) runs under the
// lock its parent holds instead of waiting for that parent forever.
export const TOKEN_ENV = "BUILD_LOCK_TOKEN"
const LOCK_NAME = "build.lock"
const OWNER_FILE = "owner.json"
const POLL_MS = 1000
const REPORT_EVERY_MS = 60 * 1000
// The holder refreshes its owner file this often while its job runs...
const HEARTBEAT_MS = 10 * 1000
// ...so one left untouched this long belongs to a holder that died, even when
// Windows has since handed its pid to another process.
export const STALE_MS = 2 * 60 * 1000
// Taking the lock and writing its owner file are milliseconds apart. A lock
// seen without one for this long was left by a process that died in between.
export const OWNER_GRACE_MS = 10 * 1000
// Windows refuses to create, read or remove a directory for a moment while
// another process deletes it. Such errors are retried, this many times.
const BUSY_CODES = ["EPERM", "EACCES", "EBUSY"]
const BUSY_RETRIES = 100
const BUSY_PAUSE_MS = 100

// The jobs that build. Each runs its lockfile-pinned CLI through Node itself,
// never through a shell, so paths with spaces (this repo lives under
// "01 PROJECTS") reach it intact.
export const JOBS: Record<string, { cli: string[]; args: string[] }> = {
  build: { cli: ["next", "dist", "bin", "next"], args: ["build"] },
  "test:e2e": { cli: ["@playwright", "test", "cli.js"], args: ["test"] },
}

export type Holder = {
  token: string
  pid: number
  // What it runs, e.g. `npm run build`.
  job: string
  checkout: string
  // When it took the lock, in epoch milliseconds.
  since: number
}

// What a waiter finds in an existing lock directory.
export type LockSnapshot = {
  // Undefined while the holder is still writing it, or if it can't be parsed.
  owner: Holder | undefined
  // When the holder last refreshed its owner file.
  refreshedMs: number
  // Whether the owner's pid is a running process.
  alive: boolean
}

export type Abandoned = { kind: "abandoned"; holder?: Holder; reason: string }

export type LockState = { kind: "free" } | { kind: "starting" } | { kind: "held"; holder: Holder } | Abandoned

// `missingSince` is when this waiter first found the lock without an owner, in
// its current run of lookups. A lock that stays that way was abandoned.
export function assessLock(lock: LockSnapshot | undefined, now: number, missingSince: number): LockState {
  if (lock === undefined) return { kind: "free" }
  const { owner } = lock
  if (owner === undefined) {
    if (now - missingSince < OWNER_GRACE_MS) return { kind: "starting" }
    return { kind: "abandoned", reason: "it has no readable owner record" }
  }
  if (!lock.alive) return { kind: "abandoned", holder: owner, reason: `process ${owner.pid} is gone` }
  const silent = now - lock.refreshedMs
  if (silent > STALE_MS) {
    return { kind: "abandoned", holder: owner, reason: `its holder has not checked in for ${formatDuration(silent)}` }
  }
  return { kind: "held", holder: owner }
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, "0")}s`
}

export function describeHolder(holder: Holder, now: number): string {
  return `${holder.job} in ${holder.checkout} (pid ${holder.pid}, running ${formatDuration(now - holder.since)})`
}

// Vercel and CI build on machines of their own, with nothing to wait for.
export function lockSkipped(env: Record<string, string | undefined>): boolean {
  return Boolean(env.VERCEL || env.CI)
}

// Whether the lock belongs to the process that started this one.
export function heldByParent(parentToken: string | undefined, owner: Holder | undefined): boolean {
  return Boolean(parentToken) && parentToken === owner?.token
}

function isBusy(error: unknown): boolean {
  return BUSY_CODES.includes((error as NodeJS.ErrnoException).code ?? "")
}

function isHolder(value: unknown): value is Holder {
  const holder = value as Holder
  return typeof holder?.token === "string" && Number.isInteger(holder.pid)
}

function snapshot(lockDir: string, alive: (pid: number) => boolean): LockSnapshot | undefined {
  if (statSync(lockDir, { throwIfNoEntry: false }) === undefined) return undefined
  const file = join(lockDir, OWNER_FILE)
  const stat = statSync(file, { throwIfNoEntry: false })
  if (stat === undefined) return { owner: undefined, refreshedMs: 0, alive: false }
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    // Released between the stat and the read.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { owner: undefined, refreshedMs: 0, alive: false }
    throw error
  }
  let owner: unknown
  try {
    owner = JSON.parse(text)
  } catch {
    owner = undefined
  }
  if (!isHolder(owner)) return { owner: undefined, refreshedMs: 0, alive: false }
  return { owner, refreshedMs: stat.mtimeMs, alive: alive(owner.pid) }
}

// Creates the lock directory and records who holds it. False if it exists.
function take(lockDir: string, holder: Holder): boolean {
  try {
    mkdirSync(lockDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
    throw error
  }
  try {
    // Written aside and renamed in, so a waiter never reads half a record.
    const draft = join(lockDir, `${OWNER_FILE}.tmp`)
    writeFileSync(draft, JSON.stringify(holder))
    renameSync(draft, join(lockDir, OWNER_FILE))
  } catch (error) {
    // Nobody else can hold a lock this process created a moment ago.
    rmSync(lockDir, { recursive: true, force: true })
    throw error
  }
  return true
}

export type Deps = {
  now: () => number
  pause: (ms: number) => void
  alive: (pid: number) => boolean
  log: (line: string) => void
}

export type Acquired =
  | { outcome: "taken"; holder: Holder; waitedMs: number }
  // The process that started this one holds the lock.
  | { outcome: "inherited" }
  | { outcome: "abandoned"; lock: Abandoned }

// Takes the lock, waiting while a live holder has it. Returns without taking
// it when the holder is this process's parent, or when the holder died.
export function acquire(
  lockDir: string,
  who: Omit<Holder, "since">,
  parentToken: string | undefined,
  deps: Deps,
): Acquired {
  const start = deps.now()
  let reported: string | undefined
  let reportedAt = start
  let missingSince: number | undefined
  let busy = 0
  for (;;) {
    let state: LockState
    try {
      const holder = { ...who, since: deps.now() }
      if (take(lockDir, holder)) return { outcome: "taken", holder, waitedMs: deps.now() - start }
      const lock = snapshot(lockDir, deps.alive)
      const now = deps.now()
      if (lock === undefined || lock.owner !== undefined) missingSince = undefined
      else missingSince ??= now
      if (heldByParent(parentToken, lock?.owner)) return { outcome: "inherited" }
      state = assessLock(lock, now, missingSince ?? now)
      busy = 0
    } catch (error) {
      if (!isBusy(error) || ++busy > BUSY_RETRIES) throw error
      deps.pause(BUSY_PAUSE_MS)
      continue
    }
    if (state.kind === "abandoned") return { outcome: "abandoned", lock: state }
    if (state.kind === "held") {
      const now = deps.now()
      if (state.holder.token !== reported) {
        deps.log(`Another build holds the build lock: ${describeHolder(state.holder, now)}.`)
        deps.log(`Waiting for it to finish before starting ${who.job}.`)
        reported = state.holder.token
        reportedAt = now
      } else if (now - reportedAt >= REPORT_EVERY_MS) {
        deps.log(`Still waiting for the build lock (${formatDuration(now - start)} so far).`)
        reportedAt = now
      }
    }
    if (state.kind !== "free") deps.pause(POLL_MS)
  }
}

// Removes the lock, but only while it is still the one this process took.
export function release(lockDir: string, token: string, pause: (ms: number) => void) {
  for (let attempt = 0; ; attempt++) {
    try {
      if (snapshot(lockDir, () => true)?.owner?.token !== token) return
      rmSync(lockDir, { recursive: true, force: true, maxRetries: 10, retryDelay: BUSY_PAUSE_MS })
      return
    } catch (error) {
      if (!isBusy(error) || attempt >= BUSY_RETRIES) throw error
      pause(BUSY_PAUSE_MS)
    }
  }
}

const LIVE: Deps = {
  now: () => Date.now(),
  pause: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      // EPERM: the process exists but belongs to someone else.
      return (error as NodeJS.ErrnoException).code === "EPERM"
    }
  },
  log: (line) => console.log(line),
}

// The lock lives in the git common dir, which every worktree of this repo
// shares. Undefined when the job should run without it.
function lockPath(root: string): string | undefined {
  if (lockSkipped(process.env)) return undefined
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return join(resolve(root, common), LOCK_NAME)
  } catch {
    console.warn("Not in a git checkout, so this runs without the build lock.")
    return undefined
  }
}

function run(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env })
    // Ctrl+C and a closing terminal reach the job too. Stay alive until it
    // has exited, so the lock is released after the build stops, not before.
    const wait = () => {}
    const forward = () => child.kill("SIGTERM")
    process.on("SIGINT", wait)
    process.on("SIGHUP", wait)
    process.on("SIGTERM", forward)
    const finish = (code: number) => {
      process.off("SIGINT", wait)
      process.off("SIGHUP", wait)
      process.off("SIGTERM", forward)
      done(code)
    }
    child.on("error", (error) => {
      console.error(error.message)
      finish(1)
    })
    child.on("exit", (code) => finish(code ?? 1))
  })
}

function reportAbandoned(lockDir: string, lock: Abandoned, now: number) {
  console.error(`The build lock was left behind by a process that stopped while holding it (${lock.reason}):`)
  console.error(`  ${lockDir}`)
  if (lock.holder) {
    console.error(`It was taken by ${lock.holder.job} in ${lock.holder.checkout}, ${formatDuration(now - lock.holder.since)} ago.`)
  }
  console.error("If no build or e2e run is going on in any checkout, delete that folder and run the command again.")
}

async function main(argv: string[]): Promise<number> {
  const [name, ...extra] = argv
  const job = name === undefined ? undefined : JOBS[name]
  if (job === undefined) {
    console.error(`Usage: node scripts/build-lock.mts <${Object.keys(JOBS).join("|")}> [args]`)
    return 1
  }
  const root = resolve(import.meta.dirname, "..")
  const args = [join(root, "node_modules", ...job.cli), ...job.args, ...extra]
  const lockDir = lockPath(root)
  if (lockDir === undefined) return run(args, process.env)

  const who = { token: randomUUID(), pid: process.pid, job: `npm run ${name}`, checkout: root }
  const got = acquire(lockDir, who, process.env[TOKEN_ENV], LIVE)
  if (got.outcome === "inherited") return run(args, process.env)
  if (got.outcome === "abandoned") {
    reportAbandoned(lockDir, got.lock, Date.now())
    return 1
  }
  if (got.waitedMs >= POLL_MS) {
    console.log(`The build lock is free after ${formatDuration(got.waitedMs)}. Starting ${who.job}.`)
  }
  const owner = join(lockDir, OWNER_FILE)
  const heartbeat = setInterval(() => {
    try {
      const now = new Date()
      utimesSync(owner, now, now)
    } catch {
      // The next beat tries again.
    }
  }, HEARTBEAT_MS)
  try {
    return await run(args, { ...process.env, [TOKEN_ENV]: who.token })
  } finally {
    clearInterval(heartbeat)
    release(lockDir, who.token, LIVE.pause)
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
