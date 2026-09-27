// Runs the real script in a throwaway git repo whose `next` and `playwright`
// CLIs are stubs that log when they start and end. Covers what the unit tests
// in build-lock.test.ts can't: the child process, the token hand-off, and
// what a killed holder leaves behind.

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

// Like Playwright's webServer, runs \`npm run build\` through a shell from inside
// the e2e run, so ending this process alone leaves that build running.
const PLAYWRIGHT_STUB = `
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const log = (event) => fs.appendFileSync(process.env.STUB_LOG, event + " " + process.env.STUB_NAME + " " + Date.now() + " " + process.pid + "\\n")
log("e2e-start")
const script = path.join(__dirname, "..", "..", "..", "scripts", "build-lock.mts")
const env = { ...process.env, STUB_NAME: process.env.STUB_NAME + "/webServer" }
const build = spawnSync('"' + process.execPath + '" "' + script + '" build', { shell: true, stdio: "inherit", env })
log("e2e-end")
process.exit(build.status ?? 1)
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

  function start(job: string, name: string, env: Record<string, string> = {}): Promise<Run> {
    const clean = { ...process.env }
    delete clean.CI
    delete clean.VERCEL
    delete clean.BUILD_LOCK_TOKEN
    const child = spawn(process.execPath, [join(repo, "scripts", "build-lock.mts"), job], {
      cwd: repo,
      env: { ...clean, STUB_LOG: log, STUB_NAME: name, ...env },
    })
    started.push(child)
    let out = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (out += chunk))
    return new Promise((done) => child.on("exit", (code) => done({ code, out })))
  }

  async function lockTaken() {
    while (!existsSync(join(lockDir, "owner.json"))) await new Promise((done) => setTimeout(done, 20))
  }

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

  it("runs the e2e run's own build under the lock it holds, and makes other builds wait for the whole run", async () => {
    const e2e = start("test:e2e", "E")
    await lockTaken()
    const build = start("build", "B")
    const [e, b] = await Promise.all([e2e, build])
    expect(e.code).toBe(0)
    expect(b.code).toBe(0)
    const at = events()
    expect(at["start E/webServer"]).toBeGreaterThan(at["e2e-start E"])
    expect(at["end E/webServer"]).toBeLessThanOrEqual(at["e2e-end E"])
    expect(at["start B"]).toBeGreaterThanOrEqual(at["e2e-end E"])
    expect(existsSync(lockDir)).toBe(false)
  }, 30_000)

  it("keeps the lock until the build Playwright started has ended, when Playwright alone is killed", async () => {
    const e2e = start("test:e2e", "E", { STUB_MS: "2000" })
    let runner = 0
    while (!runner) {
      const line = existsSync(log) ? readFileSync(log, "utf8").split("\n") : []
      if (line.some((entry) => entry.startsWith("start E/webServer"))) {
        runner = Number(line.find((entry) => entry.startsWith("e2e-start E"))?.split(" ")[3])
      } else await new Promise((done) => setTimeout(done, 20))
    }
    process.kill(runner, "SIGKILL")
    const build = start("build", "B")
    const [e, b] = await Promise.all([e2e, build])
    expect(e.out).toContain("Waiting for the build it started")
    expect(b.code).toBe(0)
    const at = events()
    expect(at["end E/webServer"]).toBeDefined()
    expect(at["start B"]).toBeGreaterThanOrEqual(at["end E/webServer"])
  }, 30_000)

  it("passes the job's exit code through and still releases the lock", async () => {
    expect((await start("build", "A", { STUB_EXIT: "3" })).code).toBe(3)
    expect(existsSync(lockDir)).toBe(false)
  }, 30_000)

  it("reports the lock of a holder that was killed, and leaves it for a person to delete", async () => {
    const holder = start("build", "A", { STUB_MS: "20000" })
    while (!(existsSync(log) && readFileSync(log, "utf8").includes("start A"))) {
      await new Promise((done) => setTimeout(done, 20))
    }
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
