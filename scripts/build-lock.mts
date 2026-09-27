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

import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

// Set in the job's environment to the holder's token, so a build the job
// starts itself (Playwright's webServer runs `npm run build`) runs under the
// lock its parent holds instead of waiting for that parent forever.
// playwright.config.ts checks for it too.
export const TOKEN_ENV = "BUILD_LOCK_TOKEN"
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

export type Acquired =
  | { outcome: "taken"; holder: Holder; waitedMs: number }
  // The process that started this one holds the lock.
  | { outcome: "inherited" }
  | { outcome: "abandoned"; lock: Abandoned }

// Takes the lock, waiting while a live holder has it. Returns without taking
// it when the holder is this process's parent, or when the holder died.
export async function acquire(
  lockDir: string,
  who: Omit<Holder, "since">,
  parentToken: string | undefined,
  deps: Deps,
): Promise<Acquired> {
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
      if (heldByParent(parentToken, lock?.owner)) return { outcome: "inherited" }
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

// A build that runs under its parent's lock leaves a file named after its pid
// in the lock directory while it runs. Ending Playwright alone doesn't end the
// build its webServer started, so the holder waits for these before releasing.
function markNested(lockDir: string): () => void {
  const mark = join(lockDir, `nested-${process.pid}`)
  try {
    writeFileSync(mark, "")
  } catch {
    // The lock went away; there is nothing to hold open.
  }
  return () => rmSync(mark, { force: true })
}

export function nestedBuilds(lockDir: string, alive: (pid: number) => boolean): number[] {
  let names: string[]
  try {
    names = readdirSync(lockDir)
  } catch {
    return []
  }
  return names
    .map((name) => Number(name.match(/^nested-(\d+)$/)?.[1]))
    .filter((pid) => Number.isInteger(pid) && alive(pid))
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

// Installed before anything else, so no signal can stop this process between
// taking the lock and releasing it. Until the job starts, this process holds
// nothing it must release, so Ctrl+C stops it. Once the job runs, Ctrl+C,
// Ctrl+Break and a closing console reach the job directly, and this process
// waits for it to exit before releasing the lock. A SIGTERM or hangup sent to
// this process alone is passed on as SIGINT, which Playwright answers by
// stopping its web server. Windows can't deliver either, and child.kill() there
// would kill the job outright.
function guardSignals(job: () => ChildProcess | undefined) {
  const onInterrupt = () => {
    if (job() === undefined) process.exit(130)
  }
  const onTerminate = () => {
    const child = job()
    if (child === undefined) process.exit(143)
    if (process.platform !== "win32") child.kill("SIGINT")
  }
  process.on("SIGINT", onInterrupt)
  process.on("SIGBREAK", onInterrupt)
  process.on("SIGHUP", onTerminate)
  process.on("SIGTERM", onTerminate)
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
  let child: ChildProcess | undefined
  guardSignals(() => child)
  const run = (env: NodeJS.ProcessEnv) =>
    new Promise<number>((done) => {
      child = spawn(process.execPath, args, { stdio: "inherit", env })
      child.on("error", (error) => {
        console.error(error.message)
        done(1)
      })
      child.on("exit", (code) => done(code ?? 1))
    })

  const lockDir = lockPath(root)
  // An empty token tells playwright.config.ts this run came through here.
  if (lockDir === undefined) return run({ ...process.env, [TOKEN_ENV]: process.env[TOKEN_ENV] ?? "" })
  const who = { token: randomUUID(), pid: process.pid, job: `npm run ${name}`, checkout: root }
  const got = await acquire(lockDir, who, process.env[TOKEN_ENV], LIVE)
  if (got.outcome === "inherited") {
    const unmark = markNested(lockDir)
    try {
      return await run(process.env)
    } finally {
      unmark()
    }
  }
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
    code = await run({ ...process.env, [TOKEN_ENV]: who.token })
    for (let told = false; ; told = true) {
      const nested = nestedBuilds(lockDir, LIVE.alive)
      if (nested.length === 0) break
      if (!told) console.log(`Waiting for the build it started (pid ${nested.join(", ")}) before releasing the build lock.`)
      await sleep(POLL_MS)
    }
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
