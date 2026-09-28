// Runs the real script in a throwaway git repo whose `next` and `playwright`
// CLIs are stubs that log when they start and end. Covers what the unit tests
// in build-lock.test.ts can't: the child processes, the order of the e2e
// steps, and what a killed holder leaves behind.

import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

const NEXT_STUB = `
const fs = require("node:fs")
const log = (event) => fs.appendFileSync(process.env.STUB_LOG, event + " " + process.env.STUB_NAME + " " + Date.now() + " " + process.pid + "\\n")
log("start")
setTimeout(() => {
  log("end")
  process.exit(Number(process.env.STUB_EXIT ?? 0))
}, Number(process.env.STUB_MS ?? 800))
`

// Logs whether it was told the app is already built, as playwright.config.ts
// requires, and the extra arguments it was given.
const PLAYWRIGHT_STUB = `
const fs = require("node:fs")
const log = (event) => fs.appendFileSync(process.env.STUB_LOG, event + " " + process.env.STUB_NAME + " " + Date.now() + " " + process.pid + "\\n")
log("e2e-start")
log("prebuilt=" + process.env.E2E_PREBUILT)
log("args=" + process.argv.slice(2).join(","))
setTimeout(() => {
  log("e2e-end")
  process.exit(0)
}, Number(process.env.STUB_E2E_MS ?? 800))
`

type Run = { code: number | null; out: string }

describe("scripts/build-lock.mts", () => {
  let repo: string
  let log: string
  let lockDir: string
  const started: ChildProcess[] = []

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "build-lock-repo-"))
    execFileSync("git", ["init", "-q"], { cwd: repo })
    const script = join(repo, "scripts", "build-lock.mts")
    mkdirSync(dirname(script))
    copyFileSync(join("scripts", "build-lock.mts"), script)
    for (const [file, body] of [
      [join(repo, "node_modules", "next", "dist", "bin", "next"), NEXT_STUB],
      [join(repo, "node_modules", "@playwright", "test", "cli.js"), PLAYWRIGHT_STUB],
    ]) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, body)
    }
    log = join(repo, "stub.log")
    lockDir = join(repo, ".git", "build.lock")
  })

  afterEach(() => {
    for (const child of started.splice(0)) child.kill("SIGKILL")
    for (const line of existsSync(log) ? readFileSync(log, "utf8").split("\n") : []) {
      const pid = Number(line.split(" ")[3])
      if (pid) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          // Already gone.
        }
      }
    }
    rmSync(repo, { recursive: true, force: true })
  })

  function start(job: string, name: string, env: Record<string, string> = {}, extra: string[] = []): Promise<Run> {
    const clean = { ...process.env }
    delete clean.CI
    delete clean.VERCEL
    delete clean.E2E_PREBUILT
    const child = spawn(process.execPath, [join(repo, "scripts", "build-lock.mts"), job, ...extra], {
      cwd: repo,
      env: { ...clean, STUB_LOG: log, STUB_NAME: name, ...env },
    })
    started.push(child)
    let out = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (out += chunk))
    return new Promise((done) => child.on("exit", (code) => done({ code, out })))
  }

  async function waitFor(done: () => boolean) {
    while (!done()) await new Promise((wake) => setTimeout(wake, 20))
  }

  const lockTaken = () => waitFor(() => existsSync(join(lockDir, "owner.json")))
  const logged = (entry: string) => existsSync(log) && readFileSync(log, "utf8").includes(entry)

  // When each stub started and ended, by name.
  function events(): Record<string, number> {
    const times: Record<string, number> = {}
    for (const line of readFileSync(log, "utf8").trim().split("\n")) {
      const [event, name, at] = line.split(" ")
      times[`${event} ${name}`] = Number(at)
    }
    return times
  }

  it("runs a second build only after the first has finished", async () => {
    const first = start("build", "A")
    await lockTaken()
    const second = start("build", "B")
    const [a, b] = await Promise.all([first, second])
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    expect(b.out).toContain("Another build holds the build lock: npm run build in")
    expect(b.out).toMatch(/The build lock is free after \d+s\. Starting npm run build\./)
    const at = events()
    expect(at["start B"]).toBeGreaterThanOrEqual(at["end A"])
    expect(existsSync(lockDir)).toBe(false)
  }, 30_000)

  it("builds before Playwright starts, and makes other builds wait for the whole e2e run", async () => {
    const e2e = start("test:e2e", "E", {}, ["e2e/login.spec.ts"])
    await lockTaken()
    const build = start("build", "B")
    const [e, b] = await Promise.all([e2e, build])
    expect(e.code).toBe(0)
    expect(b.code).toBe(0)
    const at = events()
    expect(at["e2e-start E"]).toBeGreaterThanOrEqual(at["end E"])
    expect(at["prebuilt=1 E"]).toBeDefined()
    expect(at["args=test,e2e/login.spec.ts E"]).toBeDefined()
    expect(at["start B"]).toBeGreaterThanOrEqual(at["e2e-end E"])
    expect(existsSync(lockDir)).toBe(false)
  }, 30_000)

  it("skips Playwright when the build fails, and releases the lock", async () => {
    const e2e = await start("test:e2e", "E", { STUB_EXIT: "2" })
    expect(e2e.code).toBe(2)
    expect(logged("e2e-start")).toBe(false)
    expect(existsSync(lockDir)).toBe(false)
  }, 30_000)

  it("releases the lock once Playwright is killed, with no build left running", async () => {
    const e2e = start("test:e2e", "E", { STUB_E2E_MS: "20000" })
    await waitFor(() => logged("e2e-start E"))
    const runner = Number(readFileSync(log, "utf8").split("\n").find((entry) => entry.startsWith("e2e-start E"))?.split(" ")[3])
    process.kill(runner, "SIGKILL")
    expect((await e2e).code).not.toBe(0)
    expect(existsSync(lockDir)).toBe(false)
    expect((await start("build", "B")).code).toBe(0)
  }, 30_000)

  it("passes the job's exit code through and still releases the lock", async () => {
    expect((await start("build", "A", { STUB_EXIT: "3" })).code).toBe(3)
    expect(existsSync(lockDir)).toBe(false)
  }, 30_000)

  it("reports the lock of a holder that was killed, and leaves it for a person to delete", async () => {
    const holder = start("build", "A", { STUB_MS: "20000" })
    await waitFor(() => logged("start A"))
    started[started.length - 1].kill("SIGKILL")
    await holder
    const next = await start("build", "B")
    expect(next.code).toBe(1)
    expect(next.out).toContain("The build lock was left behind by a process that stopped while holding it")
    expect(next.out).toContain(lockDir)
    expect(existsSync(join(lockDir, "owner.json"))).toBe(true)
    expect(readFileSync(log, "utf8")).not.toContain("start B")
  }, 30_000)
})
