import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  acquire,
  assessLock,
  type Deps,
  formatDuration,
  heldByParent,
  type Holder,
  JOBS,
  lockSkipped,
  OWNER_GRACE_MS,
  release,
  STALE_MS,
} from "@/scripts/build-lock.mjs"

const other: Holder = {
  token: "token-other",
  pid: 4242,
  job: "npm run build",
  checkout: "D:/repo/.claude/worktrees/other",
  since: 0,
}

describe("assessLock", () => {
  const now = 60 * 60 * 1000
  const live = { owner: other, refreshedMs: now - 5000, alive: true }

  it("finds no lock free", () => {
    expect(assessLock(undefined, now, now)).toEqual({ kind: "free" })
  })

  it("waits on a live holder that keeps checking in", () => {
    expect(assessLock(live, now, now)).toEqual({ kind: "held", holder: other })
  })

  it("reports a lock whose holder's process is gone", () => {
    expect(assessLock({ ...live, alive: false }, now, now)).toEqual({
      kind: "abandoned",
      holder: other,
      reason: "process 4242 is gone",
    })
  })

  it("reports a holder that stopped checking in, even when its pid runs again", () => {
    const state = assessLock({ ...live, refreshedMs: now - STALE_MS - 1000 }, now, now)
    expect(state).toEqual({
      kind: "abandoned",
      holder: other,
      reason: "its holder has not checked in for 2m 01s",
    })
  })

  it("gives a new lock time to record its owner", () => {
    const noOwner = { owner: undefined, refreshedMs: 0, alive: false }
    expect(assessLock(noOwner, now, now - OWNER_GRACE_MS + 1)).toEqual({ kind: "starting" })
  })

  it("reports a lock that stays without an owner record", () => {
    const noOwner = { owner: undefined, refreshedMs: 0, alive: false }
    expect(assessLock(noOwner, now, now - OWNER_GRACE_MS)).toEqual({
      kind: "abandoned",
      reason: "it has no readable owner record",
    })
  })
})

describe("formatDuration", () => {
  it("shows seconds under a minute and minutes with padded seconds above", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(45_400)).toBe("45s")
    expect(formatDuration(125_000)).toBe("2m 05s")
  })
})

describe("lockSkipped", () => {
  it("skips the lock on Vercel and in CI, which build on machines of their own", () => {
    expect(lockSkipped({ VERCEL: "1" })).toBe(true)
    expect(lockSkipped({ CI: "true" })).toBe(true)
    expect(lockSkipped({})).toBe(false)
  })
})

describe("heldByParent", () => {
  it("matches only the token of the lock's current holder", () => {
    expect(heldByParent("token-other", other)).toBe(true)
    expect(heldByParent("token-left-over", other)).toBe(false)
    expect(heldByParent(undefined, other)).toBe(false)
    expect(heldByParent("", { ...other, token: "" })).toBe(false)
    expect(heldByParent("token-other", undefined)).toBe(false)
  })
})

describe("JOBS", () => {
  it("builds with `next build` and tests with `playwright test`", () => {
    expect(JOBS.build.args).toEqual(["build"])
    expect(JOBS["test:e2e"].args).toEqual(["test"])
  })

  it("points each job at a CLI that is installed", () => {
    for (const job of Object.values(JOBS)) {
      expect(existsSync(join("node_modules", ...job.cli))).toBe(true)
    }
  })
})

describe("acquire and release", () => {
  const me = { token: "token-me", pid: 1111, job: "npm run test:e2e", checkout: "D:/repo/.claude/worktrees/me" }
  let dir: string
  let lockDir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "build-lock-"))
    lockDir = join(dir, "build.lock")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // A clock that only moves when the waiter pauses, and a hook to act on the
  // lock after a given number of pauses.
  function fake(options: { alive?: (pid: number) => boolean; afterPause?: (count: number) => void } = {}) {
    const clock = { now: Date.now() }
    const lines: string[] = []
    let pauses = 0
    const deps: Deps = {
      now: () => clock.now,
      pause: (ms) => {
        clock.now += ms
        options.afterPause?.(++pauses)
      },
      alive: options.alive ?? (() => true),
      log: (line) => lines.push(line),
    }
    return { deps, lines, clock }
  }

  function hold(owner: Holder) {
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, "owner.json"), JSON.stringify(owner))
  }

  it("takes a free lock and records who holds it", () => {
    const { deps } = fake()
    expect(acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "taken", waitedMs: 0 })
    expect(JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8"))).toMatchObject(me)
  })

  it("waits while another checkout builds, then takes the lock", () => {
    hold({ ...other, since: Date.now() - 65_000 })
    const { deps, lines } = fake({ afterPause: (n) => n === 3 && rmSync(lockDir, { recursive: true }) })
    expect(acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "taken", waitedMs: 3000 })
    expect(lines).toEqual([
      "Another build holds the build lock: npm run build in D:/repo/.claude/worktrees/other (pid 4242, running 1m 05s).",
      "Waiting for it to finish before starting npm run test:e2e.",
    ])
  })

  it("says once a minute that it is still waiting", () => {
    hold(other)
    const { deps, lines } = fake({ afterPause: (n) => n === 61 && rmSync(lockDir, { recursive: true }) })
    expect(acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "taken", waitedMs: 61_000 })
    expect(lines.slice(2)).toEqual(["Still waiting for the build lock (1m 00s so far)."])
  })

  it("waits on a leftover token that isn't the holder's", () => {
    hold(other)
    const { deps } = fake({ afterPause: (n) => n === 1 && rmSync(lockDir, { recursive: true }) })
    expect(acquire(lockDir, me, "token-left-over", deps)).toMatchObject({ outcome: "taken", waitedMs: 1000 })
  })

  it("runs under the lock its parent holds instead of waiting for it", () => {
    hold(other)
    const { deps } = fake()
    expect(acquire(lockDir, me, other.token, deps)).toEqual({ outcome: "inherited" })
    expect(existsSync(lockDir)).toBe(true)
  })

  it("reports a lock whose holder died, and leaves it in place", () => {
    hold(other)
    const { deps } = fake({ alive: () => false })
    expect(acquire(lockDir, me, undefined, deps)).toEqual({
      outcome: "abandoned",
      lock: { kind: "abandoned", holder: other, reason: "process 4242 is gone" },
    })
    expect(existsSync(join(lockDir, "owner.json"))).toBe(true)
  })

  it("reports a lock that never got an owner record, after the grace period, and leaves it", () => {
    mkdirSync(lockDir)
    const { deps, clock } = fake()
    const start = clock.now
    expect(acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "abandoned" })
    expect(clock.now - start).toBe(OWNER_GRACE_MS)
    expect(existsSync(lockDir)).toBe(true)
  })

  it("releases only the lock it took", () => {
    hold(other)
    release(lockDir, me.token, () => {})
    expect(existsSync(lockDir)).toBe(true)
    release(lockDir, other.token, () => {})
    expect(existsSync(lockDir)).toBe(false)
  })
})
