import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  acquire,
  assessLock,
  type Deps,
  NOTHING_SEEN,
  formatDuration,
  heldByParent,
  type Holder,
  JOBS,
  lockSkipped,
  observe,
  OWNER_GRACE_LOOKS,
  release,
  STALE_LOOKS,
  startHeartbeat,
} from "@/scripts/build-lock.mjs"

const other: Holder = {
  token: "token-other",
  pid: 4242,
  job: "npm run build",
  checkout: "D:/repo/.claude/worktrees/other",
  since: 0,
}

describe("observe", () => {
  const lock = { owner: other, refreshedMs: 1000, alive: true }

  it("counts looks at an owner file that hasn't moved", () => {
    const once = observe(NOTHING_SEEN, lock)
    expect(once.quietLooks).toBe(0)
    expect(observe(observe(once, lock), lock).quietLooks).toBe(2)
  })

  it("starts counting again when the holder checks in or the holder changes", () => {
    const quiet = observe(observe(NOTHING_SEEN, lock), lock)
    expect(observe(quiet, { ...lock, refreshedMs: 11_000 }).quietLooks).toBe(0)
    expect(observe(quiet, { ...lock, owner: { ...other, token: "token-next" } }).quietLooks).toBe(0)
  })

  it("counts looks at a lock without an owner record, and forgets them once the lock is gone", () => {
    const noOwner = { owner: undefined, refreshedMs: 0, alive: false }
    expect(observe(observe(NOTHING_SEEN, noOwner), noOwner).missingLooks).toBe(2)
    expect(observe(observe(NOTHING_SEEN, noOwner), undefined)).toEqual(NOTHING_SEEN)
  })
})

describe("assessLock", () => {
  const live = { owner: other, refreshedMs: 1000, alive: true }
  const noOwner = { owner: undefined, refreshedMs: 0, alive: false }

  it("finds no lock free", () => {
    expect(assessLock(undefined, NOTHING_SEEN)).toEqual({ kind: "free" })
  })

  it("waits on a live holder that keeps checking in", () => {
    expect(assessLock(live, { ...NOTHING_SEEN, quietLooks: STALE_LOOKS - 1 })).toEqual({ kind: "held", holder: other })
  })

  it("reports a lock whose holder's process is gone", () => {
    expect(assessLock({ ...live, alive: false }, NOTHING_SEEN)).toEqual({
      kind: "abandoned",
      holder: other,
      reason: "process 4242 is gone",
    })
  })

  it("reports a holder that stopped checking in, even when its pid runs again", () => {
    expect(assessLock(live, { ...NOTHING_SEEN, quietLooks: STALE_LOOKS })).toEqual({
      kind: "abandoned",
      holder: other,
      reason: "its holder has not checked in for 2m 00s",
    })
  })

  it("gives a new lock time to record its owner", () => {
    expect(assessLock(noOwner, { ...NOTHING_SEEN, missingLooks: OWNER_GRACE_LOOKS - 1 })).toEqual({ kind: "starting" })
  })

  it("reports a lock that stays without an owner record", () => {
    expect(assessLock(noOwner, { ...NOTHING_SEEN, missingLooks: OWNER_GRACE_LOOKS })).toEqual({
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

describe("acquire, release and the heartbeat", () => {
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
      pause: async (ms) => {
        clock.now += ms
        pauses++
        options.afterPause?.(pauses)
      },
      alive: options.alive ?? (() => true),
      log: (line) => lines.push(line),
    }
    return { deps, lines, clock, pauses: () => pauses }
  }

  function hold(owner: Holder) {
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, "owner.json"), JSON.stringify(owner))
  }

  // The holder releases the lock after the waiter's `count`th pause.
  function freeAfter(pauses: number, count: number) {
    if (pauses === count) rmSync(lockDir, { recursive: true })
  }

  function checkIn() {
    const now = new Date(Date.now() + 1000)
    utimesSync(join(lockDir, "owner.json"), now, now)
  }

  it("takes a free lock and records who holds it", async () => {
    const { deps } = fake()
    expect(await acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "taken", waitedMs: 0 })
    expect(JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8"))).toMatchObject(me)
  })

  it("waits while another checkout builds, then takes the lock", async () => {
    hold({ ...other, since: Date.now() - 65_000 })
    const { deps, lines } = fake({ afterPause: (n) => freeAfter(n, 3) })
    expect(await acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "taken", waitedMs: 3000 })
    expect(lines).toEqual([
      "Another build holds the build lock: npm run build in D:/repo/.claude/worktrees/other (pid 4242, running 1m 05s).",
      "Waiting for it to finish before starting npm run test:e2e.",
    ])
  })

  it("says once a minute that it is still waiting", async () => {
    hold(other)
    const { deps, lines } = fake({
      afterPause: (n) => {
        if (n % 10 === 0) checkIn()
        freeAfter(n, 61)
      },
    })
    expect(await acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "taken", waitedMs: 61_000 })
    expect(lines.slice(2)).toEqual(["Still waiting for the build lock (1m 00s so far)."])
  })

  it("keeps waiting on a holder that checks in after the machine wakes from sleep", async () => {
    // Its last check-in was 45 minutes ago by the clock, which jumped ahead
    // while the machine slept; the holder checks in again soon after waking.
    hold(other)
    const sleepMs = 45 * 60 * 1000
    utimesSync(join(lockDir, "owner.json"), new Date(Date.now() - sleepMs), new Date(Date.now() - sleepMs))
    const { deps, clock } = fake({
      afterPause: (n) => {
        if (n === 5) checkIn()
        freeAfter(n, 8)
      },
    })
    clock.now += sleepMs
    expect(await acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "taken" })
  })

  it("reports a holder whose owner file stops moving, and leaves the lock in place", async () => {
    hold(other)
    const { deps, pauses } = fake()
    expect(await acquire(lockDir, me, undefined, deps)).toMatchObject({
      outcome: "abandoned",
      lock: { reason: "its holder has not checked in for 2m 00s" },
    })
    expect(pauses()).toBe(STALE_LOOKS)
    expect(existsSync(join(lockDir, "owner.json"))).toBe(true)
  })

  it("waits on a leftover token that isn't the holder's", async () => {
    hold(other)
    const { deps } = fake({ afterPause: (n) => freeAfter(n, 1) })
    expect(await acquire(lockDir, me, "token-left-over", deps)).toMatchObject({ outcome: "taken", waitedMs: 1000 })
  })

  it("runs under the lock its parent holds instead of waiting for it", async () => {
    hold(other)
    const { deps } = fake()
    expect(await acquire(lockDir, me, other.token, deps)).toEqual({ outcome: "inherited" })
    expect(existsSync(lockDir)).toBe(true)
  })

  it("reports a lock whose holder died, and leaves it in place", async () => {
    hold(other)
    const { deps } = fake({ alive: () => false })
    expect(await acquire(lockDir, me, undefined, deps)).toEqual({
      outcome: "abandoned",
      lock: { kind: "abandoned", holder: other, reason: "process 4242 is gone" },
    })
    expect(existsSync(join(lockDir, "owner.json"))).toBe(true)
  })

  it("takes the lock when its holder released it just before its pid was checked", async () => {
    hold(other)
    // The holder finishes between the waiter reading its record and checking its pid.
    const alive = () => {
      rmSync(lockDir, { recursive: true, force: true })
      return false
    }
    const { deps } = fake({ alive })
    expect(await acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "taken", waitedMs: 0 })
  })

  it("reports a lock that never got an owner record, after the grace period, and leaves it", async () => {
    mkdirSync(lockDir)
    const { deps, pauses } = fake()
    expect(await acquire(lockDir, me, undefined, deps)).toMatchObject({ outcome: "abandoned" })
    expect(pauses()).toBe(OWNER_GRACE_LOOKS - 1)
    expect(existsSync(lockDir)).toBe(true)
  })

  it("treats an unreadable owner record like a missing one", async () => {
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, "owner.json"), "{not json")
    const { deps } = fake()
    expect(await acquire(lockDir, me, undefined, deps)).toMatchObject({
      outcome: "abandoned",
      lock: { reason: "it has no readable owner record" },
    })
    expect(existsSync(join(lockDir, "owner.json"))).toBe(true)
  })

  it("releases only the lock it took", () => {
    hold(other)
    release(lockDir, me.token)
    expect(existsSync(lockDir)).toBe(true)
    release(lockDir, other.token)
    expect(existsSync(lockDir)).toBe(false)
  })

  it("moves the owner file's mtime while the holder runs", async () => {
    hold(other)
    const file = join(lockDir, "owner.json")
    utimesSync(file, new Date(0), new Date(0))
    const stop = startHeartbeat(lockDir, 20)
    await new Promise((done) => setTimeout(done, 100))
    stop()
    expect(statSync(file).mtimeMs).toBeGreaterThan(Date.now() - 60_000)
  })
})
