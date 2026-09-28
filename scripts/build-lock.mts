// Lets one Next.js build run at a time across every checkout of this repo. Two
// builds at once ran this machine (7.7 GB of RAM, about 0.2 GB free at rest)
// out of memory, and both died. `npm run build` and `npm run test:e2e` run
// their job through this script: it takes a lock that every worktree shares,
// waits while another checkout holds it, and releases it when the job exits.
// `test:e2e` builds first, then runs Playwright against that build, and holds
// the lock through both: the tests, with a server and browsers, use about as
// much memory as a build.
//
// The lock is a directory in the git common dir, like the slot locks in
// local-db.mts: creating a directory either succeeds or fails with EEXIST, so
// two processes can never both hold it. A lock whose holder died is reported,
// never removed automatically: removing it could race with a live holder.
//
// Run through npm: `npm run build` and `npm run test:e2e`.
// Node 24 runs this file directly (type stripping), so keep to erasable syntax.

import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

// Set for every step, so playwright.config.ts knows the app was built first
// and its webServer only has to start it.
export const PREBUILT_ENV = "E2E_PREBUILT"
const LOCK_NAME = "build.lock"
const OWNER_FILE = "owner.json"
// Waiters look at the lock once a second...
export const POLL_MS = 1000
// ...and the holder refreshes its owner file this often while its job runs...
export const HEARTBEAT_MS = 10 * 1000
// ...so an owner file unchanged across this many looks belongs to a holder that
// died, even when Windows has since handed its pid to another process. Counted
// in looks, not clock time: a machine that sleeps mid-build wakes with its
// clock minutes past the holder's last refresh, and that holder is fine.
export const STALE_LOOKS = 120
// Taking the lock and writing its owner file are milliseconds apart. A lock
// without one across this many looks was left by a process that died between.
export const OWNER_GRACE_LOOKS = 10
const REPORT_EVERY_MS = 60 * 1000
// Windows refuses to create, read or remove a directory for a moment while
// another process deletes it. Such errors are retried, this many times.
const BUSY_CODES = ["EPERM", "EACCES", "EBUSY"]
const BUSY_RETRIES = 100
const BUSY_PAUSE_MS = 100

// The jobs that build, as steps run one after another under one lock. Each
// step runs its lockfile-pinned CLI through Node itself, never through a
// shell, so paths with spaces (this repo lives under "01 PROJECTS") reach it
// intact. Extra arguments go to the last step.
export type Step = { cli: string[]; args: string[] }
const NEXT_BUILD: Step = { cli: ["next", "dist", "bin", "next"], args: ["build"] }
export const JOBS: Record<string, Step[]> = {
  build: [NEXT_BUILD],
  "test:e2e": [NEXT_BUILD, { cli: ["@playwright", "test", "cli.js"], args: ["test"] }],
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
  // The owner file's mtime, which the holder's heartbeat moves.
  refreshedMs: number
  // Whether the owner's pid is a running process.
  alive: boolean
}

// What one waiter has seen of the lock over its looks so far.
export type Watch = { token?: string; refreshedMs?: number; quietLooks: number; missingLooks: number }

export const NOTHING_SEEN: Watch = { quietLooks: 0, missingLooks: 0 }

export function observe(watch: Watch, lock: LockSnapshot | undefined): Watch {
  if (lock === undefined) return NOTHING_SEEN
  const { owner, refreshedMs } = lock
  if (owner === undefined) return { quietLooks: 0, missingLooks: watch.missingLooks + 1 }
  const unchanged = owner.token === watch.token && refreshedMs === watch.refreshedMs
  return { token: owner.token, refreshedMs, quietLooks: unchanged ? watch.quietLooks + 1 : 0, missingLooks: 0 }
}

export type Abandoned = { kind: "abandoned"; holder?: Holder; reason: string }

export type LockState = { kind: "free" } | { kind: "starting" } | { kind: "held"; holder: Holder } | Abandoned

export function assessLock(lock: LockSnapshot | undefined, watch: Watch): LockState {
  if (lock === undefined) return { kind: "free" }
  const { owner } = lock
  if (owner === undefined) {
    if (watch.missingLooks < OWNER_GRACE_LOOKS) return { kind: "starting" }
    return { kind: "abandoned", reason: "it has no readable owner record" }
  }
  if (!lock.alive) return { kind: "abandoned", holder: owner, reason: `process ${owner.pid} is gone` }
  if (watch.quietLooks >= STALE_LOOKS) {
    const quiet = formatDuration(watch.quietLooks * POLL_MS)
    return { kind: "abandoned", holder: owner, reason: `its holder has not checked in for ${quiet}` }
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
  const noOwner = { owner: undefined, refreshedMs: 0, alive: false }
  const stat = statSync(file, { throwIfNoEntry: false })
  if (stat === undefined) return noOwner
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    // Released between the stat and the read.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return noOwner
    throw error
  }
  let owner: unknown
  try {
    owner = JSON.parse(text)
  } catch {
    return noOwner
  }
  if (!isHolder(owner)) return noOwner
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
  pause: (ms: number) => Promise<void>
  alive: (pid: number) => boolean
  log: (line: string) => void
}

export type Acquired = { outcome: "taken"; holder: Holder; waitedMs: number } | { outcome: "abandoned"; lock: Abandoned }

// Takes the lock, waiting while a live holder has it. Returns without taking
// it when the holder died.
export async function acquire(lockDir: string, who: Omit<Holder, "since">, deps: Deps): Promise<Acquired> {
  const start = deps.now()
  let reported: string | undefined
  let reportedAt = start
  let watch = NOTHING_SEEN
  let busy = 0
  for (;;) {
    let state: LockState
    try {
      const holder = { ...who, since: deps.now() }
      if (take(lockDir, holder)) return { outcome: "taken", holder, waitedMs: deps.now() - start }
      const lock = snapshot(lockDir, deps.alive)
      watch = observe(watch, lock)
      state = assessLock(lock, watch)
      // A holder can finish, release and exit between our reading its record
      // and checking its pid. Only a lock it still owns was left behind.
      if (state.kind === "abandoned" && state.holder !== undefined) {
        if (ownerToken(lockDir) !== state.holder.token) continue
      }
      busy = 0
    } catch (error) {
      if (!isBusy(error) || ++busy > BUSY_RETRIES) throw error
      await deps.pause(BUSY_PAUSE_MS)
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
    if (state.kind !== "free") await deps.pause(POLL_MS)
  }
}

function ownerToken(lockDir: string): string | undefined {
  return snapshot(lockDir, () => true)?.owner?.token
}

// Blocks, where release() runs: in a finally that must finish before exit.
function pauseSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Removes the lock, but only while it is still the one this process took.
export function release(lockDir: string, token: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      if (ownerToken(lockDir) !== token) return
      rmSync(lockDir, { recursive: true, force: true, maxRetries: 10, retryDelay: BUSY_PAUSE_MS })
      return
    } catch (error) {
      if (!isBusy(error) || attempt >= BUSY_RETRIES) throw error
      pauseSync(BUSY_PAUSE_MS)
    }
  }
}

// Moves the owner file's mtime every `everyMs`, so waiters can tell this holder
// is alive. Returns a function that stops it.
export function startHeartbeat(lockDir: string, everyMs: number): () => void {
  const file = join(lockDir, OWNER_FILE)
  const timer = setInterval(() => {
    try {
      const now = new Date()
      utimesSync(file, now, now)
    } catch {
      // The next beat tries again.
    }
  }, everyMs)
  return () => clearInterval(timer)
}

const LIVE: Deps = {
  now: () => Date.now(),
  pause: (ms) => sleep(ms),
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

type Run = { started: boolean; stopping: boolean; step?: ChildProcess }

// Installed before anything else, so no signal can stop this process between
// taking the lock and releasing it. While it waits for the lock it holds
// nothing, so a signal stops it at once. Once its steps have started, a signal
// stops the running step, skips the rest, and the lock is released after the
// step has exited. Ctrl+C, Ctrl+Break and a closing console reach the step
// directly. Any signal sent to this process alone is passed on as SIGINT, which
// Playwright answers by stopping its web server. Windows can't deliver one, and
// child.kill() there would kill the step outright.
function guardSignals(run: Run) {
  const stop = (exitCode: number) => {
    if (!run.started) process.exit(exitCode)
    run.stopping = true
    if (process.platform !== "win32") run.step?.kill("SIGINT")
  }
  process.on("SIGINT", () => stop(130))
  process.on("SIGBREAK", () => stop(130))
  process.on("SIGHUP", () => stop(129))
  process.on("SIGTERM", () => stop(143))
}

// Runs the steps one after another and stops at the first that fails.
async function runSteps(steps: Step[], root: string, extra: string[], run: Run): Promise<number> {
  const env = { ...process.env, [PREBUILT_ENV]: "1" }
  run.started = true
  for (const [index, step] of steps.entries()) {
    if (run.stopping) return 130
    const args = [join(root, "node_modules", ...step.cli), ...step.args, ...(index === steps.length - 1 ? extra : [])]
    const code = await new Promise<number>((done) => {
      run.step = spawn(process.execPath, args, { stdio: "inherit", env })
      run.step.on("error", (error) => {
        console.error(error.message)
        done(1)
      })
      run.step.on("exit", (code) => done(code ?? 1))
    })
    run.step = undefined
    if (code !== 0) return code
  }
  return 0
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
  const steps = name === undefined ? undefined : JOBS[name]
  if (steps === undefined) {
    console.error(`Usage: node scripts/build-lock.mts <${Object.keys(JOBS).join("|")}> [args]`)
    return 1
  }
  const root = resolve(import.meta.dirname, "..")
  const run: Run = { started: false, stopping: false }
  guardSignals(run)

  const lockDir = lockPath(root)
  if (lockDir === undefined) return runSteps(steps, root, extra, run)
  const who = { token: randomUUID(), pid: process.pid, job: `npm run ${name}`, checkout: root }
  const got = await acquire(lockDir, who, LIVE)
  if (got.outcome === "abandoned") {
    reportAbandoned(lockDir, got.lock, Date.now())
    return 1
  }
  const stopHeartbeat = startHeartbeat(lockDir, HEARTBEAT_MS)
  let code = 1
  try {
    if (got.waitedMs >= POLL_MS) {
      console.log(`The build lock is free after ${formatDuration(got.waitedMs)}. Starting ${who.job}.`)
    }
    code = await runSteps(steps, root, extra, run)
  } finally {
    stopHeartbeat()
    try {
      release(lockDir, who.token)
    } catch (error) {
      // The job's own result still stands; the next run reports the lock.
      console.error(`Could not remove the build lock (${(error as Error).message}):\n  ${lockDir}`)
      console.error("Close anything that has that folder open, then delete it.")
    }
  }
  return code
}

// import.meta.main arrived in Node 24.2 and package.json allows any Node 24.
// Without the fallback, an older one would skip main() and report a build that
// never ran as passing.
if (import.meta.main ?? process.argv[1]?.endsWith("build-lock.mts")) {
  process.exit(await main(process.argv.slice(2)))
}
